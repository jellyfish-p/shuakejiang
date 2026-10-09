/* =========================================================================
 * 4.5 超星/学习通 任务点 DOM 识别层
 *     对齐参考扩展（大学搜题酱）brushCx + cxDom 的真实 DOM 规则：
 *     #iframe -> /ananas/modules/* 任务框架 -> #frame_content -> 题目文档
 * ========================================================================= */

const CX_RAW_TYPES = ['video', 'audio', 'pdf', 'work'];
const CX_UNSUPPORTED_RAW_TYPES = [
  'innerbook',
  'insertbbs',
  'live',
  'downloadfile',
  'questionnaire',
  'zt',
  'flash',
  'ballchart',
  'doc',
  'insertdoc'
];

const CxDom = {
  /** 从任务框架 src 中提取原始类型（对应 /ananas/modules/<type>/） */
  rawTaskType(src) {
    if (!src) return '';
    let path = String(src);
    try {
      path = new URL(src, location.href).pathname;
    } catch (e) {}
    const m = path.match(/\/ananas\/modules\/([^/?#]+)/);
    if (m) return m[1].toLowerCase();
    if (path.includes('/ananas/dialog/ballchart')) return 'ballchart';
    return '';
  },

  /** 归一化任务类型：仅 video/audio/pdf/work 可自动处理 */
  resolveTaskType(raw) {
    if (!raw) return '';
    if (CX_RAW_TYPES.includes(raw)) return raw;
    return '';
  },

  isSupportedType(type) {
    return CX_RAW_TYPES.includes(type);
  },

  /** 该原始类型是否属于平台不支持自动处理的模块 */
  isUnsupportedRaw(raw) {
    return !!raw && (CX_UNSUPPORTED_RAW_TYPES.includes(raw) || !CX_RAW_TYPES.includes(raw));
  },

  /* ---------------- 页面/路由 ---------------- */

  studyIframe() {
    try {
      return document.getElementById('iframe');
    } catch (e) {
      return null;
    }
  },

  studyDoc() {
    try {
      const fr = this.studyIframe();
      return fr && fr.contentDocument ? fr.contentDocument : null;
    } catch (e) {
      return null;
    }
  },

  /** 学习页路由指纹（与参考扩展一致：顶层地址 + 主框架 src + 主框架文档地址） */
  routeInfo() {
    const fr = this.studyIframe();
    const href = location.href;
    const iframeSrc = (fr && fr.getAttribute('src')) || '';
    let docHref = '';
    try {
      docHref = fr?.contentDocument?.URL || fr?.contentWindow?.location?.href || '';
    } catch (e) {
      docHref = '';
    }
    if (!docHref || docHref === 'about:blank') return null;
    return {
      href,
      iframeSrc,
      mainDocumentHref: docHref,
      key: `${href}|${iframeSrc}|${docHref}`
    };
  },

  /** 学习框架是否已加载完成（避免把加载中误判为“空任务点”） */
  studyDocReady(doc = this.studyDoc()) {
    if (!doc) return false;
    try {
      const href = doc.URL || '';
      if (!href || href === 'about:blank') return false;
      return doc.readyState === 'complete' || doc.readyState === 'interactive';
    } catch (e) {
      return false;
    }
  },

  /* ---------------- 任务点扫描 ---------------- */

  /**
   * 扫描当前学习页的所有任务点
   * @returns {Array|null} null 表示页面尚未就绪
   */
  listTasks(doc = this.studyDoc()) {
    if (!doc || !this.studyDocReady(doc)) return null;
    const tasks = [];
    let iframes = [];
    try {
      iframes = Array.from(doc.getElementsByTagName('iframe'));
    } catch (e) {
      return null;
    }

    iframes.forEach((fr, idx) => {
      let src = '';
      try {
        src = fr.getAttribute('src') || fr.src || '';
      } catch (e) {
        src = '';
      }
      if (!src || /^about:blank/i.test(src)) return;
      // 批注（blockquote）内部的框架由下面的 blockquote 分支统一处理
      try {
        if (fr.closest('.cmd-autoblockquote')) return;
      } catch (e) {}
      if (!(src.includes('/ananas/modules/') || src.includes('/ananas/dialog/ballchart'))) return;
      const raw = this.rawTaskType(src);
      const type = this.resolveTaskType(raw);
      tasks.push({
        id: `frame-${idx}`,
        source: 'iframe',
        order: idx,
        iframeIndex: idx,
        src,
        rawType: raw,
        type: type || raw || 'unknown'
      });
    });

    // 批注任务点（需点击 .ans-blockquote-handle 展开 iframe）
    let wraps = [];
    try {
      wraps = Array.from(doc.querySelectorAll('.blockquote-wrap')).filter((w) =>
        w.querySelector('.cmd-autoblockquote')
      );
    } catch (e) {}
    wraps.forEach((wrap, i) => {
      const holder = wrap.querySelector('.cmd-autoblockquote');
      const inner = holder ? holder.querySelector('iframe') : null;
      let src = '';
      try {
        src = inner ? inner.getAttribute('src') || inner.src || '' : '';
      } catch (e) {}
      const raw = this.rawTaskType(src) || 'work';
      const type = this.resolveTaskType(raw) || 'work';
      iframes = Array.from(doc.getElementsByTagName('iframe'));
      tasks.push({
        id: `quote-${i}`,
        source: 'blockquote',
        order: tasks.length,
        blockIndex: i,
        iframeIndex: inner ? iframes.indexOf(inner) : -1,
        src,
        rawType: raw,
        type
      });
    });

    // 无任务框架时视为纯图文（阅读）任务点，避免卡死无法继续
    if (!tasks.length) {
      tasks.push({
        id: `text-${doc.URL || location.href}`,
        source: 'page',
        order: 0,
        iframeIndex: -1,
        src: doc.URL || location.href,
        rawType: '',
        type: 'text'
      });
    }
    return tasks;
  },

  /** 根据任务描述解析出任务框架元素（优先索引，其次 src 匹配） */
  taskIframeOf(doc, task) {
    if (!doc || !task) return null;
    try {
      if (task.source === 'blockquote') {
        const wraps = Array.from(doc.querySelectorAll('.blockquote-wrap')).filter((w) =>
          w.querySelector('.cmd-autoblockquote')
        );
        const wrap = wraps[task.blockIndex];
        return wrap?.querySelector('.cmd-autoblockquote iframe') || null;
      }
      const iframes = Array.from(doc.getElementsByTagName('iframe'));
      if (typeof task.iframeIndex === 'number' && iframes[task.iframeIndex]) {
        return iframes[task.iframeIndex];
      }
      if (task.src) {
        return (
          iframes.find((f) => {
            const src = f.getAttribute('src') || f.src || '';
            return src && (src === task.src || src.includes(task.src) || task.src.includes(src));
          }) || null
        );
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  /** 批注任务点：展开并等待框架出现 */
  async openBlockquoteTask(doc, task, timeout = 8000) {
    if (!doc || !task || task.source !== 'blockquote') return null;
    let wraps = [];
    try {
      wraps = Array.from(doc.querySelectorAll('.blockquote-wrap')).filter((w) =>
        w.querySelector('.cmd-autoblockquote')
      );
    } catch (e) {
      return null;
    }
    const wrap = wraps[task.blockIndex];
    if (!wrap) return null;
    const readIframe = () => wrap.querySelector('.cmd-autoblockquote iframe');
    const opened = readIframe();
    if (opened) return opened;
    const handle = wrap.querySelector('.ans-blockquote-handle');
    if (handle) {
      try {
        handle.removeAttribute('href');
      } catch (e) {}
      skjHumanClick(handle);
    }
    const fr = await skjWaitFor(
      () => {
        const f = readIframe();
        if (f) return f;
        if (wrap.classList.contains('open')) return false;
        return null;
      },
      { timeout, interval: 400 }
    );
    return fr || null;
  },

  /* ---------------- 完成状态判定 ---------------- */

  /** 与参考扩展一致：任务框架父容器带 ans-job-finished 且含任务点图标 */
  hasDoneKnowledge(iframeEl) {
    if (!iframeEl) return false;
    try {
      const parent = iframeEl.parentElement;
      if (parent && parent.classList.contains('ans-job-finished')) {
        if (parent.querySelector('.ans-job-icon, [class*="ans-job-icon"]')) return true;
      }
      const box = iframeEl.closest('.ans-job-finished');
      if (box) return true;
    } catch (e) {}
    return false;
  },

  /** 媒体是否播完（兼容 ended 事件不触发/被篡改的情况） */
  isMediaFinished(media) {
    if (!media) return false;
    try {
      if (media.ended) return true;
      const duration = Number(media.duration);
      if (Number.isFinite(duration) && duration > 0) {
        return media.currentTime >= duration - 0.6 && !media.seeking;
      }
    } catch (e) {}
    return false;
  },

  /* ---------------- 章节测验（work 任务点） ---------------- */

  /** 解析测验内容文档：#frame_content 内层文档 */
  workDoc(taskIframe) {
    if (!taskIframe) return null;
    try {
      const outer = taskIframe.contentDocument;
      if (!outer) return null;
      let inner = null;
      try {
        inner = outer.querySelector('#frame_content');
      } catch (e) {}
      if (!inner) {
        try {
          inner = outer.querySelector(
            'iframe[src*="work"], iframe[src*="selectWorkQuestion"], iframe[src*="exam"]'
          );
        } catch (e) {}
      }
      if (inner && inner.contentDocument) return inner.contentDocument;
      if (outer.querySelector('#ZyBottom')) return outer;
      return null;
    } catch (e) {
      return null;
    }
  },

  /** 测验结果视图（已交卷/已批阅） */
  isWorkResultView(doc) {
    if (!doc) return false;
    try {
      return !!doc.querySelector(
        '#ZyBottom .newAnswerBx, #ZyBottom .correctAnswerBx, #ZyBottom .myAllAnswerBx, .marking_dui, .marking_cuo'
      );
    } catch (e) {
      return false;
    }
  },

  /**
   * 测验状态：
   *  complete       已完成/已批阅/已提交
   *  teacherIncomplete 教师未创建完成该测验（无需作答）
   *  pendingReview  已提交待批阅
   *  active         可作答
   *  unknown        无法判断
   */
  workStatus(doc) {
    if (!doc) return 'unknown';
    try {
      const st = doc.querySelector('.testTit_status, .ceyan_status');
      if (st) {
        if (st.classList?.contains('testTit_status_complete') || st.classList?.contains('complete')) {
          return 'complete';
        }
        const text = (st.innerText || '').trim();
        if (text.includes('教师未创建完成该测验')) return 'teacherIncomplete';
        if (text.includes('待批阅')) return 'pendingReview';
        if (/已批阅|已完成|已提交/.test(text)) return 'complete';
      }
      const title = doc.title || '';
      if (title.includes('查看已批阅作业') || title.includes('查看作业')) return 'pendingReview';
      if (this.isWorkResultView(doc)) return 'complete';
      if (doc.querySelector('#ZyBottom .singleQuesId')) return 'active';
      if (doc.querySelector('#ZyBottom')) return 'unknown';
    } catch (e) {}
    return 'unknown';
  },

  countQuestions(doc) {
    try {
      return doc ? doc.querySelectorAll('#ZyBottom .singleQuesId').length : 0;
    } catch (e) {
      return 0;
    }
  },

  /* ---------------- 视频弹题 ---------------- */

  /** 视频随堂弹题是否可见（对齐参考扩展 isVideoQuizVisibleInIframe） */
  isVideoQuizVisible(taskIframe) {
    if (!taskIframe) return false;
    try {
      const doc = taskIframe.contentDocument;
      if (!doc) return false;
      const box = doc.querySelector('.x-container-default') || doc;
      const topic = box.querySelector('.ans-videoquiz .tkTopic');
      if (!topic) return false;
      return skjIsDeepVisible(taskIframe) && skjIsDeepVisible(topic);
    } catch (e) {
      return false;
    }
  },

  /** 是否启用了超星字体混淆（题目文字被替换为图形字体，AI 无法可靠识别） */
  hasFontObfuscation(doc) {
    if (!doc) return false;
    try {
      if (doc.querySelector('.font-cxsecret')) return true;
      return Array.from(doc.querySelectorAll('style')).some((el) =>
        (el.textContent || '').includes('font-cxsecret')
      );
    } catch (e) {
      return false;
    }
  }
};
