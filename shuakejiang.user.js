// ==UserScript==
// @name         刷课酱 - 网课视频助手 & AI 解题助手
// @namespace    https://github.com/jellyfish-p/shuakejiang
// @version      2.1.0
// @description  刷课酱 - 超星学习通、智慧树等网课助手：支持视频自动播放、自动连播、倍速播放、静音、防暂停；按任务点队列依次推进（自动跳过已完成任务点），全部完成后自动停止；解题助手全面升级为 OpenAI 兼容接口，支持自定义 API Key、Base URL 与模型名称（如 DeepSeek、GPT-4o 等），实现高精度题目识别与全自动答题！
// @author       jellyfish-p
// @license      MIT
// @homepageURL  https://github.com/jellyfish-p/shuakejiang
// @supportURL   https://github.com/jellyfish-p/shuakejiang/issues
// @updateURL    https://raw.githubusercontent.com/jellyfish-p/shuakejiang/main/shuakejiang.user.js
// @downloadURL  https://raw.githubusercontent.com/jellyfish-p/shuakejiang/main/shuakejiang.user.js
// @match        *://*.chaoxing.com/*
// @match        *://*.xuexitong.com/*
// @match        *://*.zhihuishu.com/*
// @match        *://*.icve.com.cn/*
// @match        *://*.icourse163.org/*
// @match        *://*.xuetangx.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addElement
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================================
   * 0. 全局环境与反检测倍速 HOOK (必须在 document-start 最先执行)
   * ========================================================================= */

  /**
   * 为指定 window 注入媒体元素反检测 Hook
   * 确保能够跨 iframe 穿透并彻底解除超星等网课平台的倍速检测与强制暂停限制
   */
  function hookMediaWindow(win) {
    if (!win) return;
    try {
      if (win._skj_media_hooked) return;
      win._skj_media_hooked = true;

      const proto = win.HTMLMediaElement?.prototype;
      if (!proto) return;

      // 1. 屏蔽网页播放器监听倍速变动与进度拖动检测
      const origAdd = proto.addEventListener;
      proto.addEventListener = function (type, listener, options) {
        // 拦截 ratechange、seeked、seeking，防止超星等脚本捕获倍速变动后强行重置或暂停
        if (type === 'ratechange' || type === 'seeked' || type === 'seeking') {
          return;
        }
        return origAdd.call(this, type, listener, options);
      };

      // 2. 劫持 playbackRate 属性描述符 (实现倍速伪装与防篡改)
      const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
      if (origDesc) {
        win._skj_native_rate_desc = origDesc;
        Object.defineProperty(proto, 'playbackRate', {
          configurable: true,
          enumerable: true,
          get: function () {
            // 外部或超星检测代码读取时，伪装返回 1.0 (防止超星检测到倍速异常强制暂停或重置)
            if (this._skj_setting_real_rate) {
              return origDesc.get.call(this);
            }
            return 1.0;
          },
          set: function (val) {
            // 仅允许刷课酱内部设置真实底层播放倍速
            if (this._skj_setting_real_rate) {
              origDesc.set.call(this, val);
              this._skj_real_rate = val;
            } else {
              // 拦截并丢弃外部脚本尝试强制重置倍速为 1 的操作
            }
          }
        });
      }

      // 3. 屏蔽 onratechange, onseeked, onseeking 属性赋值
      ['onratechange', 'onseeked', 'onseeking'].forEach((prop) => {
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: true,
          get: () => null,
          set: () => {}
        });
      });
    } catch (e) {
      console.warn('[刷课酱] HOOK HTMLMediaElement 失败:', e);
    }
  }

  // 立即在当前窗口执行 (document-start)
  const rootWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  hookMediaWindow(rootWin);

  /* =========================================================================
   * 0.5 通用 DOM / 异步工具 (所有平台模块共用)
   *     命名统一使用 skj 前缀，避免与宿主页面及内部模块冲突
   * ========================================================================= */

  function skjSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  /** 等待 Promise，但不会因为宿主 API 永不 resolve 而卡死任务队列 */
  function skjWithTimeout(value, timeout = 10000, fallback = null) {
    return Promise.race([
      Promise.resolve(value),
      new Promise((resolve) => setTimeout(() => resolve(fallback), Math.max(0, Number(timeout) || 0)))
    ]);
  }

  /** 当前是否顶层窗口 */
  function skjIsTopFrame() {
    try {
      return window.self === window.top;
    } catch (e) {
      return false;
    }
  }

  /** 能否读取顶层窗口文档（同源） */
  function skjCanReachTop() {
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow.top ? unsafeWindow.top : window.top;
      return !!(w && w.document && w.document.body);
    } catch (e) {
      return false;
    }
  }

  /** 安全获取顶层文档 */
  function skjTopDocument() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow.top && unsafeWindow.top.document) {
        return unsafeWindow.top.document;
      }
    } catch (e) {}
    try {
      return window.top.document || document;
    } catch (e) {
      return document;
    }
  }

  /** 元素在自身文档中是否“占位可见”（display/visibility + 尺寸） */
  function skjIsDisplayed(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const win = el.ownerDocument?.defaultView || window;
      const st = win.getComputedStyle(el);
      if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return true;
      return !!el.offsetParent;
    } catch (e) {
      return false;
    }
  }

  /** 元素自身及全部祖先均可见且尺寸有效（用于弹窗判定） */
  function skjIsDeepVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const win = el.ownerDocument?.defaultView || window;
      let node = el;
      while (node && node.nodeType === 1) {
        const st = win.getComputedStyle(node);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  }

  /** 模拟真实鼠标点击（部分平台只认 mousedown/mouseup/click 全链路） */
  function skjHumanClick(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const win = el.ownerDocument?.defaultView || window;
      try {
        el.removeAttribute('href');
      } catch (e) {}
      ['mousedown', 'mouseup', 'click'].forEach((type) => {
        try {
          el.dispatchEvent(
            new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, button: 0 })
          );
        } catch (e) {}
      });
      return true;
    } catch (e) {
      try {
        el.click();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  /** 元素的计算 display 值（用于超星弹题答错标记判定等场景） */
  function skjDisplayOf(el) {
    try {
      return el.ownerDocument.defaultView.getComputedStyle(el).display || '';
    } catch (e) {
      return '';
    }
  }

  /** 触发输入框的 input/change 事件 */
  function skjFireInput(el) {
    if (!el || el.nodeType !== 1) return;
    try {
      const win = el.ownerDocument?.defaultView || window;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      el.dispatchEvent(new win.Event('blur', { bubbles: true }));
    } catch (e) {}
  }

  /** 轮询等待条件成立，返回条件值；超时返回 null */
  function skjWaitFor(check, options = {}) {
    const timeout = Number(options.timeout) || 10000;
    const interval = Number(options.interval) || 250;
    const cancelled = typeof options.cancelled === 'function' ? options.cancelled : null;
    return new Promise((resolve) => {
      const started = Date.now();
      const run = () => {
        if (cancelled && cancelled()) return resolve(null);
        let value = null;
        try {
          value = check();
        } catch (e) {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - started >= timeout) return resolve(null);
        setTimeout(run, interval);
      };
      run();
    });
  }

  function skjEscapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 提取选项文本开头的大写字母（如 "A、正确" -> "A"） */
  function skjLeadingLetter(text) {
    const m = String(text == null ? '' : text)
      .trim()
      .match(/^[（(]?\s*([A-Za-z])\s*(?:[、.，,．。)）:：]|\s|$)/);
    return m ? m[1].toUpperCase() : '';
  }

  /** 选项文本是否命中答案（按开头字母或全文匹配） */
  function skjOptionMatches(optionText, answer) {
    const text = String(optionText == null ? '' : optionText).trim();
    const letter = skjLeadingLetter(text);
    const ans = String(answer == null ? '' : answer).trim();
    if (letter && ans && letter === ans.toUpperCase()) return true;
    return !!text && text === ans;
  }

  /** 在多个文档中按选择器顺序查找第一个元素（options.visible=true 时要求可见） */
  function skjFindInDocs(docs, selector, options = {}) {
    const requireVisible = !!options.visible;
    for (const doc of docs || []) {
      let el = null;
      try {
        el = doc && doc.querySelector ? doc.querySelector(selector) : null;
      } catch (e) {
        el = null;
      }
      if (!el) continue;
      if (!requireVisible || skjIsDisplayed(el)) return el;
    }
    return null;
  }

  /** 在多个文档中按选择器顺序查找第一个元素 */
  function skjQueryDocs(docs, selector) {
    for (const doc of docs || []) {
      try {
        if (doc && doc.querySelector) {
          const el = doc.querySelector(selector);
          if (el) return el;
        }
      } catch (e) {}
    }
    return null;
  }

  /** 收集同一源框架链路上的文档（自身 + 所有可访问的同源子文档） */
  function skjCollectDocs(root) {
    const docs = [];
    const seen = new Set();
    const walk = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
      let frames = [];
      try {
        frames = Array.from(doc.querySelectorAll('iframe, frame'));
      } catch (e) {}
      frames.forEach((fr) => {
        try {
          const child = fr.contentDocument;
          if (child) walk(child);
        } catch (e) {}
      });
    };
    walk(root || document);
    return docs;
  }

  /** 追加可见日志（同一 key 只记一次，避免刷屏） */
  function skjLogOnce(key, message, level = 'info') {
    const store = (AppState._skjOnceKeys = AppState._skjOnceKeys || new Set());
    if (store.has(key)) return;
    store.add(key);
    AppState.log(message, level);
  }

  /* =========================================================================
   * 1. 存储与配置中心
   * ========================================================================= */
  const Storage = {
    get(key, defaultVal) {
      try {
        let gmVal = undefined;
        if (typeof GM_getValue !== 'undefined') {
          gmVal = GM_getValue(key, undefined);
        }
        if (gmVal !== undefined && gmVal !== null && gmVal !== '') {
          return gmVal;
        }
        const localVal = localStorage.getItem('skj_' + key);
        if (localVal !== null && localVal !== undefined) {
          const parsed = JSON.parse(localVal);
          if (parsed !== undefined && parsed !== null && parsed !== '') {
            // 同步回 GM_setValue 实现跨域多平台全局共享
            if (typeof GM_setValue !== 'undefined') {
              try {
                GM_setValue(key, parsed);
              } catch (e) {}
            }
            return parsed;
          }
        }
        return gmVal !== undefined && gmVal !== null ? gmVal : defaultVal;
      } catch (e) {
        return defaultVal;
      }
    },
    set(key, val) {
      try {
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue(key, val);
        }
        try {
          localStorage.setItem('skj_' + key, JSON.stringify(val));
        } catch (e) {}
      } catch (e) {
        console.error('[刷课酱] 保存配置失败:', e);
      }
    }
  };

  const DEFAULT_CONFIG = {
    // 视频助手设置
    videoEnabled: true,
    autoPlay: true,
    autoNext: true,
    skipFinished: true, // 检查任务点是否已完成并自动跳过
    playbackRate: 1.0, // 默认 1.0x 原速
    muted: true,
    autoSolveVideoQuiz: true,

    // AI 解题助手设置（OpenAI 兼容格式）
    examEnabled: true,
    openaiBaseUrl: 'https://api.deepseek.com/v1',
    openaiApiKey: '',
    openaiModel: 'deepseek-flash',
    openaiTemperature: 0.1,
    autoSubmit: true, // 默认开启做题自动提交
    solveInterval: 2000, // 每题间隔（毫秒）

    // 界面设置
    panelPosition: { top: 80, right: 20 }
  };

  function getConfig() {
    const cfg = {};
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      cfg[k] = Storage.get(k, DEFAULT_CONFIG[k]);
    }
    return cfg;
  }

  function setConfig(cfg) {
    for (const k of Object.keys(cfg)) {
      Storage.set(k, cfg[k]);
    }
  }

  /* =========================================================================
   * 2. 日志与状态管理器
   * ========================================================================= */
  const AppState = {
    status: '就绪',
    isPlayingVideo: false,
    isSolvingQuiz: false,
    logs: [],
    listeners: new Set(),

    setStatus(text) {
      this.status = text;
      this.notify();
    },

    log(msg, level = 'info') {
      const time = new Date().toLocaleTimeString();
      const item = { time, msg, level };
      this.logs.push(item);
      if (this.logs.length > 80) this.logs.shift();
      console.log(`[刷课酱][${time}] ${msg}`);
      this.notify();
    },

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },

    notify() {
      this.listeners.forEach((fn) => {
        try {
          fn(this);
        } catch (e) {}
      });
    }
  };

  /* =========================================================================
   * 3. OpenAI 兼容接口请求层
   * ========================================================================= */
  function requestOpenAI(prompt, systemPrompt, config) {
    return new Promise((resolve, reject) => {
      const apiKey = (config.openaiApiKey || '').trim();
      if (!apiKey) {
        return reject(new Error('未填写 OpenAI API Key，请在助手面板中配置！'));
      }

      let baseUrl = (config.openaiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

      const messages = [
        {
          role: 'system',
          content:
            systemPrompt ||
            '你是一个专业严谨的网课做题助手。请根据用户提供的题目、题型以及可选选项，给出最准确的答案。\n' +
              '【输出规范】\n' +
              '1. 单选题：只输出正确选项的大写英文字母，例如：A\n' +
              '2. 多选题：只输出所有正确选项的大写英文字母组合，例如：ABCD\n' +
              '3. 判断题：若选项为A/B则输出A或B；否则只输出"正确"或"错误"（或"对"或"错"）\n' +
              '4. 填空题：只输出各空答案，多个空之间必须用井号"#"隔开，例如：答案1#答案2\n' +
              '5. 简答题/名词解释/计算题：直接输出精简准确的答案内容\n' +
              '【注意】绝对不要包含任何解析、说明、思考过程或多余标点！'
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const body = {
        model: config.openaiModel || 'gpt-4o-mini',
        messages: messages,
        temperature: typeof config.openaiTemperature === 'number' ? config.openaiTemperature : 0.1
      };

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      };

      // 优先使用油猴专用的 GM_xmlhttpRequest 解决跨域限制
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: endpoint,
          headers: headers,
          data: JSON.stringify(body),
          timeout: 45000,
          onload: function (res) {
            try {
              const data = JSON.parse(res.responseText);
              if (res.status >= 200 && res.status < 300) {
                const answer = data.choices?.[0]?.message?.content || '';
                resolve(answer);
              } else {
                const errMsg = data.error?.message || `HTTP ${res.status}: ${res.statusText}`;
                reject(new Error(errMsg));
              }
            } catch (e) {
              reject(new Error(`响应数据解析失败: ${res.responseText.slice(0, 100)}`));
            }
          },
          ontimeout: function () {
            reject(new Error('请求超时 (45s)，请检查 API 地址与网络连接'));
          },
          onerror: function (err) {
            reject(new Error('网络请求异常，请检查接口地址与代理设置'));
          }
        });
      } else {
        // 原生 fetch 降级处理：同样提供超时，避免请求永久占用任务队列
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = setTimeout(() => {
          try {
            controller?.abort();
          } catch (e) {}
        }, 45000);
        fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {})
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.choices?.[0]?.message?.content) {
              resolve(data.choices[0].message.content);
            } else {
              reject(new Error(data.error?.message || '请求失败'));
            }
          })
          .catch((err) => {
            if (controller?.signal?.aborted) reject(new Error('请求超时 (45s)，请检查 API 地址与网络连接'));
            else reject(err);
          })
          .finally(() => clearTimeout(timeoutId));
      }
    });
  }

  /* =========================================================================
   * 题目解析与格式化工具
   * ========================================================================= */

  /**
   * 格式化提问 Prompt
   */
  function buildQuestionPrompt(type, title, options = []) {
    let p = `【题型】${type}\n【题目】${title.trim()}\n`;
    if (options && options.length > 0) {
      p += `【选项】\n${options.map((opt) => opt.trim()).join('\n')}\n`;
    }
    p += '\n请直接给出正确答案：';
    return p;
  }

  /**
   * 解析大语言模型返回的答案文本为结构化数据
   */
  function parseAnswerFromLLM(questionType, rawContent) {
    let text = (rawContent || '').trim();
    // 移除 markdown 代码块与强调符号
    text = text.replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1').replace(/\*\*/g, '').trim();

    if (questionType.includes('单选')) {
      const m = text.match(/(?:答案|选择|选项)?(?:[:：\s])?([A-Ha-h])(?!\w)/);
      if (m) return m[1].toUpperCase();
      const first = text.match(/[A-Ha-h]/);
      return first ? first[0].toUpperCase() : text;
    } else if (questionType.includes('多选')) {
      const m = text.match(/(?:答案|选择|选项)?(?:[:：\s])?([A-Ha-h]{2,8})/);
      if (m) return m[1].toUpperCase();
      const letters = text.match(/[A-Ha-h]/g);
      if (letters) {
        return Array.from(new Set(letters)).sort().join('').toUpperCase();
      }
      return text;
    } else if (questionType.includes('判断')) {
      if (/正确|对|√|true|True|T|yes/i.test(text)) return '正确';
      if (/错误|错|×|false|False|F|no/i.test(text)) return '错误';
      const m = text.match(/[ABab]/);
      if (m) return m[0].toUpperCase() === 'A' ? '正确' : '错误';
      return text;
    } else if (questionType.includes('填空')) {
      return text.replace(/\n+/g, '#');
    }
    return text;
  }

  /* =========================================================================
   * 4. 平台与页面特征检测
   * ========================================================================= */
  const Site = {
    isChaoxing: /chaoxing\.com|xuexitong\.com/.test(location.hostname),
    isZhihuishu: /zhihuishu\.com/.test(location.hostname),
    isIcve: /icve\.com\.cn/.test(location.hostname),
    isMooc: /icourse163\.org/.test(location.hostname),
    isXuetang: /xuetangx\.com/.test(location.hostname),

    // 超星学习任务页
    isCxStudentStudy: /studentstudy/.test(location.href),
    // 超星作业/考试独立页面
    isCxWorkOrExam: /dowork|doHomeWork|reVersionPaperMarkContent|reVersionTestStartNew/.test(location.href),
    // 智慧树视频学习页
    isZhsStudy: /stuStudy|fusioncourseh5|point/.test(location.href),
    // 智慧树作业/考试
    isZhsExam: /stuExamWeb|ReviewExam|dohomework/.test(location.href)
  };

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
    async openBlockquoteTask(doc, task, timeout = 8000, cancelled = null) {
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
        { timeout, interval: 400, cancelled }
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

  /* =========================================================================
   * 5.1 超星/学习通 任务点队列执行器
   *     对齐参考扩展（大学搜题酱）的 taskRunner / navigator：
   *     1) 扫描当前学习页的全部任务点（video/audio/pdf/work/text）
   *     2) 跳过已完成任务点，逐个执行
   *     3) 队列排空 → 点击【下一节】继续；无下一节 → 判定课程全部完成
   *     4) 处理超星“任务点未完成”提示弹窗
   * ========================================================================= */

  class CxCourseRunner {
    constructor(videoAssist) {
      this.va = videoAssist;
      this.routeKey = '';
      this.routeSeenAt = 0;
      this.epoch = 0;
      this.queue = null;
      this.index = 0;
      this.running = false;
      this.runningEpoch = 0;
      this.tickPromise = null;
      this.drainPromise = null;
      this.completed = false;
      this.drainedAt = 0;
      this.drainRetry = 0;
      this.jumpLock = 0;
      this.failCount = 0;
      this.warnedIds = new Set();
    }

    reset() {
      this.routeKey = '';
      this.routeSeenAt = 0;
      this.epoch += 1;
      this.queue = null;
      this.index = 0;
      // 不要把 running 强行清零：旧异步任务仍在执行时，tickPromise/epoch
      // 会负责阻止新任务重入，并让旧任务在下一个取消点退出。
      this.completed = false;
      this.drainedAt = 0;
      this.drainRetry = 0;
      this.jumpLock = 0;
      this.failCount = 0;
    }

    /** 取消当前任务，但保留当前队列/路由，供手动强制跳转使用 */
    cancelCurrent() {
      this.epoch += 1;
    }

    /** 主流循环调用：返回 true 表示本 tick 已由超星逻辑接管 */
    async tick(config) {
      if (this.tickPromise) return this.tickPromise;
      const promise = this.runTick(config);
      this.tickPromise = promise;
      try {
        return await promise;
      } finally {
        if (this.tickPromise === promise) this.tickPromise = null;
      }
    }

    async runTick(config) {
      if (!Site.isCxStudentStudy) return false;

      const route = CxDom.routeInfo();
      if (!route) return true; // 学习框架尚未就绪
      if (!config.videoEnabled && !config.examEnabled) return true;

      if (route.key !== this.routeKey) {
        this.routeKey = route.key;
        this.routeSeenAt = Date.now();
        this.epoch += 1;
        this.queue = null;
        this.index = 0;
        this.completed = false;
        this.drainedAt = 0;
        this.drainRetry = 0;
        this.failCount = 0;
        AppState.log('检测到学习页面切换，正在重新识别任务点...');
        return true;
      }

      if (this.running) return true;
      if (Date.now() < this.jumpLock) return true;
      if (this.completed) return true;

      if (!this.queue) {
        const tasks = CxDom.listTasks();
        if (!tasks) return true;
        // 页面刚切换时任务点可能尚未渲染，延长观察窗口，避免把延迟出现的 iframe
        // 误判为纯图文任务点并提前跳走。
        const realTasks = tasks.filter((t) => t.source !== 'page');
        if (!realTasks.length && Date.now() - (this.routeSeenAt || 0) < 12000) return true;
        this.queue = tasks;
        this.index = 0;
        AppState.log(`识别到 ${tasks.length} 个任务点：${tasks.map((t) => t.type).join(' → ')}`);
      }

      // 跳过已完成 / 不支持的任务点
      while (this.queue[this.index]) {
        const task = this.queue[this.index];
        const reason = this.skipReasonOf(task, config);
        if (!reason) break;
        AppState.log(`跳过任务点 [#${this.index + 1} ${task.type}]：${reason}`);
        this.index += 1;
        this.failCount = 0;
      }

      const task = this.queue[this.index];
      if (!task) {
        await this.drain(config);
        return true;
      }
      await this.run(task, config);
      return true;
    }

    /** 任务点跳过原因；null 表示需要执行 */
    skipReasonOf(task, config) {
      const doc = CxDom.studyDoc();

      // 功能性开关优先判定
      if ((task.type === 'video' || task.type === 'audio' || task.type === 'pdf') && !config.videoEnabled) {
        return '视频助手已关闭';
      }
      if (task.type === 'work' && !config.examEnabled) return 'AI 解题助手已关闭';

      if (!config.skipFinished) {
        if (!CxDom.isSupportedType(task.type) && task.type !== 'text') {
          return '本平台暂不支持该类型任务点，已跳过';
        }
        return null;
      }
      try {
        if (task.type === 'video' || task.type === 'audio' || task.type === 'pdf') {
          const fr = CxDom.taskIframeOf(doc, task);
          if (fr && CxDom.hasDoneKnowledge(fr)) return '任务点已完成';
          if (task.type !== 'pdf' && fr && fr.contentDocument) {
            const media = this.va.findMediaElements(fr.contentDocument)[0];
            if (media && CxDom.isMediaFinished(media)) return '视频已播放至末尾';
          }
          return null;
        }
        if (task.type === 'work') {
          const fr = CxDom.taskIframeOf(doc, task);
          const workDoc = fr ? CxDom.workDoc(fr) : null;
          if (workDoc) {
            const status = CxDom.workStatus(workDoc);
            if (status === 'complete') return '测验已完成/已批阅';
            if (status === 'pendingReview') return '测验已提交待批阅';
            if (status === 'teacherIncomplete') return '教师未创建完成该测验';
          }
          if (fr && CxDom.hasDoneKnowledge(fr)) return '任务点已完成';
          return null;
        }
        if (task.type === 'text') return null;
      } catch (e) {}
      return '本平台暂不支持该类型任务点，已跳过';
    }

    async run(task, config) {
      this.running = true;
      const epoch = this.epoch;
      this.runningEpoch = epoch;
      AppState.setStatus(`正在处理任务点 [#${this.index + 1}/${this.queue.length}] ${task.type}`);
      let result = 'failed';
      try {
        if (task.type === 'video') result = await this.execMedia(task, config, 'video');
        else if (task.type === 'audio') result = await this.execMedia(task, config, 'audio');
        else if (task.type === 'pdf') result = await this.execPdf(task, config);
        else if (task.type === 'work') result = await this.execWork(task, config);
        else if (task.type === 'text') result = await this.execText(task, config);
        else result = await this.execUnsupported(task, config);
      } catch (e) {
        AppState.log(`任务点处理异常: ${e.message}`, 'error');
        result = 'failed';
      } finally {
        // 只有当前 run 仍是持有者时才释放 running，避免旧任务覆盖新状态。
        if (this.runningEpoch === epoch) {
          this.running = false;
          this.runningEpoch = 0;
          if (this.epoch === epoch) AppState.setStatus('运行中');
        }
      }

      if (this.epoch !== epoch) return; // 页面已切换，结果作废

      if (result === 'done' || result === 'skipped') {
        this.index += 1;
        this.failCount = 0;
        return;
      }
      if (result === 'paused') return;
      // failed：最多重试 3 次，避免死循环
      this.failCount += 1;
      if (this.failCount >= 3) {
        AppState.log(`任务点 [#${this.index + 1} ${task.type}] 连续处理失败，已跳过`, 'warn');
        this.index += 1;
        this.failCount = 0;
      }
    }

    /* ---------------------------------------------------------------------
     * 任务执行器
     * ------------------------------------------------------------------- */

    async execMedia(task, config, kind) {
      const epoch = this.epoch;
      let iframe = CxDom.taskIframeOf(CxDom.studyDoc(), task);

      // 批注任务点需要先展开
      if (!iframe && task.source === 'blockquote') {
        iframe = await CxDom.openBlockquoteTask(CxDom.studyDoc(), task, 8000, () => this.epoch !== epoch);
        if (this.epoch !== epoch) return 'paused';
        if (!iframe) return this.warnOnce(task, '批注任务点未展开出内容，已跳过', 'skipped');
      }
      if (!iframe) return this.warnOnce(task, '未找到任务点内容框架，已跳过', 'skipped');

      // 在任务框架内查找音视频元素（对齐参考扩展 waitForTaskVideoEl）
      const findMedia = (frame) =>
        skjWaitFor(
          () => {
            try {
              const d = frame.contentDocument;
              if (!d) return null;
              const selector = kind === 'audio' ? 'audio' : 'video';
              return d.querySelector(selector) || d.querySelector('video, audio');
            } catch (e) {
              return null;
            }
          },
          { timeout: 25000, interval: 500, cancelled: () => this.epoch !== epoch }
        );

      let media = await findMedia(iframe);
      if (this.epoch !== epoch) return 'paused';
      if (!media) return this.warnOnce(task, '当前任务点未找到音视频，已跳过', 'skipped');

      const initialConfig = config || getConfig();
      if (!initialConfig.videoEnabled) return 'paused';
      if (initialConfig.skipFinished && CxDom.hasDoneKnowledge(iframe)) return 'done';

      try {
        if (initialConfig.muted) media.muted = true;
      } catch (e) {}
      this.va.applyPlaybackRate(media, initialConfig.playbackRate);
      AppState.log(
        `开始播放${kind === 'audio' ? '音频' : '视频'}：${String(task.src || '').split('/').slice(-3, -1).join('/') || '当前任务点'}`
      );

      if (initialConfig.autoPlay && media.paused && !media.ended) {
        try {
          await skjWithTimeout(media.play(), 5000);
        } catch (e) {
          try {
            media.muted = true;
            await skjWithTimeout(media.play(), 5000);
          } catch (e2) {}
        }
      }

      const startedAt = Date.now();
      let quizTries = 0;
      let lostFrames = 0;
      while (true) {
        if (!this.va.active) return 'paused';
        if (this.epoch !== epoch) return 'paused';
        const liveConfig = getConfig();
        if (!liveConfig.videoEnabled) return 'paused';

        // 平台可能重建任务点框架，此时需要重新解析框架与媒体元素
        if (!iframe.isConnected) {
          lostFrames += 1;
          if (lostFrames >= 3) return this.warnOnce(task, '任务点框架已被平台重建，已跳过', 'skipped');
          const again = CxDom.taskIframeOf(CxDom.studyDoc(), task);
          if (!again) {
            await skjSleep(1000);
            continue;
          }
          iframe = again;
          const againMedia = await findMedia(iframe);
          if (this.epoch !== epoch) return 'paused';
          if (againMedia) {
            media = againMedia;
            try {
              if (liveConfig.muted) media.muted = true;
            } catch (e) {}
            this.va.applyPlaybackRate(media, liveConfig.playbackRate);
          }
          await skjSleep(600);
          continue;
        }

        if (CxDom.isMediaFinished(media)) {
          try {
            media.pause();
          } catch (e) {}
          AppState.log('当前任务点播放完毕');
          return 'done';
        }
        if (liveConfig.skipFinished && CxDom.hasDoneKnowledge(iframe)) return 'done';

        this.va.applyPlaybackRate(media, liveConfig.playbackRate);
        this.va.handlePauseArtifacts(iframe.contentDocument);

        if (liveConfig.autoSolveVideoQuiz && CxDom.isVideoQuizVisible(iframe)) {
          const r = await this.va.cxSolveVideoQuiz(iframe, liveConfig, quizTries);
          if (r === 'retry') {
            quizTries += 1;
            if (quizTries >= 3) {
              AppState.log('视频弹题连续答错 3 次，已暂停当前任务，请手动处理后再继续', 'warn');
              return 'paused';
            }
          }
          if (this.epoch !== epoch) return 'paused';
        }

        if (liveConfig.autoPlay && media.paused && !media.ended) {
          try {
            await skjWithTimeout(media.play(), 5000);
          } catch (e) {}
        }

        if (Date.now() - startedAt > 50 * 60 * 1000) {
          AppState.log('单个任务点处理超过 50 分钟，已跳过', 'warn');
          return 'skipped';
        }
        await skjSleep(800);
      }
    }

    async execPdf(task, config) {
      const epoch = this.epoch;
      const iframe = CxDom.taskIframeOf(CxDom.studyDoc(), task);
      if (!iframe) return this.warnOnce(task, '未找到文档任务框架，已跳过', 'skipped');

      const panView = await skjWaitFor(
        () => {
          try {
            return iframe.contentDocument ? iframe.contentDocument.getElementById('panView') : null;
          } catch (e) {
            return null;
          }
        },
        { timeout: 25000, interval: 600, cancelled: () => this.epoch !== epoch }
      );
      if (this.epoch !== epoch) return 'paused';
      if (!(config || getConfig()).videoEnabled) return 'paused';
      if (!panView) return this.warnOnce(task, '未检测到文档阅读容器，已跳过该任务点', 'skipped');

      const pages = await skjWaitFor(
        () => {
          try {
            const d = panView.contentDocument;
            if (!d) return null;
            const box = d.querySelector('.fileBox');
            if (!box) return null;
            const list = Array.from(box.getElementsByTagName('li'));
            if (!list.length) return null;
            if (list.some((el) => { const img = el.querySelector('img'); return !img || !img.getAttribute('src'); })) return null;
            return list;
          } catch (e) {
            return null;
          }
        },
        { timeout: 40000, interval: 600, cancelled: () => this.epoch !== epoch }
      );
      if (this.epoch !== epoch) return 'paused';
      if (!pages) return this.warnOnce(task, '文档页面加载超时，已跳过', 'skipped');

      AppState.log('开始自动翻阅文档任务点...');
      const startedAt = Date.now();
      while (this.va.active) {
        if (this.epoch !== epoch || !iframe.isConnected) return 'paused';
        const liveConfig = getConfig();
        if (!liveConfig.videoEnabled) return 'paused';
        if (liveConfig.skipFinished && CxDom.hasDoneKnowledge(iframe)) return 'done';

        let scroller = null;
        try {
          scroller = panView.contentDocument?.documentElement;
        } catch (e) {}
        if (!scroller) return this.warnOnce(task, '文档页面已失效，已跳过', 'skipped');

        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5) break;

        let step = 240;
        try {
          const first = pages[0];
          const win = panView.contentDocument.defaultView;
          const rect = first.getBoundingClientRect();
          const margin = parseInt(win.getComputedStyle(first).marginTop || '0', 10) || 0;
          step = Math.max(160, Math.round(rect.height + margin));
        } catch (e) {}

        const nextTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight - scroller.clientHeight);
        try {
          panView.contentWindow.scrollTo({ top: nextTop, behavior: 'auto' });
        } catch (e) {
          try {
            scroller.scrollTop = nextTop;
          } catch (e2) {}
        }
        await skjSleep(650);

        if (Date.now() - startedAt > 10 * 60 * 1000) {
          AppState.log('文档自动翻阅超时，继续下一节', 'warn');
          break;
        }
      }

      this.notifyPdfFinished(task.iframeIndex);
      const done = await skjWaitFor(() => CxDom.hasDoneKnowledge(iframe), {
        timeout: 5000,
        interval: 500,
        cancelled: () => this.epoch !== epoch
      });
      if (!done) AppState.log('文档已翻阅至末尾（平台未返回完成标记，将继续下一节）', 'warn');
      return 'done';
    }

    /** 尽力通知超星文档任务点已完成 */
    notifyPdfFinished(iframeIndex) {
      const fns = ['finishJob', 'finishPdfJob', 'jobFinish'];
      const tryCall = (win) => {
        if (!win) return false;
        for (const fn of fns) {
          try {
            if (typeof win[fn] === 'function') {
              win[fn](iframeIndex);
              return true;
            }
          } catch (e) {}
        }
        return false;
      };
      try {
        if (tryCall(window)) return true;
      } catch (e) {}
      try {
        if (tryCall(CxDom.studyDoc()?.defaultView)) return true;
      } catch (e) {}
      try {
        const iframe = CxDom.taskIframeOf(CxDom.studyDoc(), { iframeIndex });
        if (iframe && tryCall(iframe.contentWindow)) return true;
      } catch (e) {}
      return false;
    }

    async execWork(task, config) {
      const epoch = this.epoch;
      const iframe = CxDom.taskIframeOf(CxDom.studyDoc(), task);

      if (!iframe && task.source === 'blockquote') {
        const fr = await CxDom.openBlockquoteTask(CxDom.studyDoc(), task, 8000, () => this.epoch !== epoch);
        if (this.epoch !== epoch) return 'paused';
        if (!fr) return this.warnOnce(task, '批注任务点未展开出内容，已跳过', 'skipped');
        return 'done';
      }
      if (!iframe) return this.warnOnce(task, '未找到测验内容框架，已跳过', 'skipped');

      if (!(config || getConfig()).examEnabled) {
        AppState.log('AI 解题助手已关闭，跳过章节测验任务点', 'warn');
        return 'skipped';
      }

      const doc = await skjWaitFor(() => CxDom.workDoc(iframe), {
        timeout: 25000,
        interval: 500,
        cancelled: () => this.epoch !== epoch
      });
      if (this.epoch !== epoch) return 'paused';
      if (!doc) return this.warnOnce(task, '未找到测验文档，已跳过', 'skipped');

      const status = CxDom.workStatus(doc);
      if (status === 'complete' || status === 'pendingReview' || status === 'teacherIncomplete') {
        AppState.log(`当前章节测验状态（${status}），无需作答`);
        return 'done';
      }

      if (!String(getConfig().openaiApiKey || '').trim()) {
        AppState.log('检测到章节测验，但未配置 API Key，已暂存并跳过（请手动完成）', 'error');
        try {
          const reason = await this.va.examAssist.saveCxWork(doc, {
            submit: false,
            cancelled: () => this.epoch !== epoch
          });
          if (reason === 'cancelled') return 'paused';
        } catch (e) {}
        return 'done';
      }

      AppState.log('检测到章节测验任务点，启动 AI 自动答题...');
      const res = await this.va.examAssist.solveCxWorkDoc(doc, config, {
        cancelled: () => this.epoch !== epoch || !getConfig().examEnabled
      });
      if (this.epoch !== epoch || res.status === 'paused') return 'paused';
      AppState.log(
        `章节测验处理完成：${res.reason || res.status}`,
        res.submitSafe === false ? 'warn' : 'info'
      );
      return 'done';
    }

    async execText(task, config) {
      const epoch = this.epoch;
      AppState.log('当前为图文/阅读任务点，停留片刻后继续...');
      try {
        const nav = this.findAny('#prevNextFocus');
        if (nav && document.visibilityState === 'visible') nav.scrollIntoView({ block: 'center' });
      } catch (e) {}
      await skjSleep(5000);
      if (this.epoch !== epoch) return 'paused';
      return 'done';
    }

    async execUnsupported(task, config) {
      if (task.source === 'blockquote') {
        const epoch = this.epoch;
        const fr = await CxDom.openBlockquoteTask(CxDom.studyDoc(), task, 6000, () => this.epoch !== epoch);
        if (fr) {
          AppState.log('已展开批注任务点');
          return 'done';
        }
      }
      return this.warnOnce(
        task,
        `任务点 [${task.rawType || task.type}] 暂不支持自动处理，已跳过（结束后请自行复查）`,
        'skipped'
      );
    }

    warnOnce(task, message, result = 'skipped') {
      const key = `cx-task-${task?.id || task?.src || task?.type}`;
      skjLogOnce(key, message, 'warn');
      return result;
    }

    /* ---------------------------------------------------------------------
     * 队列排空 → 下一节 → 课程完成判定
     * ------------------------------------------------------------------- */

    /** 当前脚本可访问的全部同源文档（顶层 + #iframe + 任务框架 …） */
    docs() {
      return skjCollectDocs(document);
    }

    findAny(selector) {
      return skjFindInDocs(this.docs(), selector);
    }

    findVisible(selector) {
      return skjFindInDocs(this.docs(), selector, { visible: true });
    }

    async drain(config) {
      if (this.drainPromise) return this.drainPromise;
      const promise = this.runDrain(config);
      this.drainPromise = promise;
      try {
        return await promise;
      } finally {
        if (this.drainPromise === promise) this.drainPromise = null;
      }
    }

    async runDrain(config) {
      if (Date.now() - this.drainedAt < 2500) return;
      this.drainedAt = Date.now();

      const liveConfig = getConfig();
      if (!liveConfig.autoNext) {
        skjLogOnce(`cx-auto-next-off-${this.routeKey}`, '当前页面任务点已全部处理完毕（自动连续播放已关闭）');
        return 'paused';
      }

      const result = await this.goNext();
      if (result === 'navigating' || result === 'paused') {
        this.drainRetry = 0;
        return;
      }
      // 与参考扩展一致的“完整”判定，但增加二次确认，避免页面重绘时误判为课程结束
      this.drainRetry += 1;
      if (this.drainRetry < 2) {
        AppState.log('未检测到可跳转的下一节，正在二次确认...', 'warn');
        return;
      }
      this.completed = true;
      this.va.stopAllMedia();
      AppState.setStatus('课程已全部完成');
      AppState.log('🎉 未检测到【下一节】，当前课程已全部学习完成，已停止自动跳转', 'info');
    }

    /**
     * 跳转下一节
     *  @returns 'navigating' | 'none'
     */
    async goNext() {
      const epoch = this.epoch;

      // 与参考扩展一致：先把底部导航滚入视野（触发平台懒加载/检测），再点击
      try {
        const nav = this.findAny('#prevNextFocus');
        if (nav && document.visibilityState === 'visible') nav.scrollIntoView({ block: 'center' });
      } catch (e) {}
      await skjSleep(1200);
      if (this.epoch !== epoch) return 'navigating';
      if (!getConfig().autoNext) return 'paused';

      // 1) 等待【下一节】按钮出现（刚提交完测验/切章时页面可能正在重绘）
      const next = await skjWaitFor(
        () => (this.epoch === epoch ? this.findVisible('#prevNextFocusNext') : null),
        { timeout: 4000, interval: 400, cancelled: () => this.epoch !== epoch }
      );
      if (this.epoch !== epoch) return 'navigating';
      if (!getConfig().autoNext) return 'paused';
      if (next) {
        AppState.log('任务点已全部完成，点击【下一节】继续学习');
        skjHumanClick(next);
        this.jumpLock = Date.now() + 6000;
        this.handleJobFinishTip(this.routeKey);
        return 'navigating';
      }

      // 2) 不同壳版本的备用【下一节】入口
      const alt = this.findVisible('.nextChapter, #prevNextFocus .nextChapter, a.next-node, a.nextChapter');
      if (alt && getConfig().autoNext) {
        AppState.log('【下一节】按钮不可见，尝试点击备用跳转入口');
        skjHumanClick(alt);
        this.jumpLock = Date.now() + 6000;
        this.handleJobFinishTip(this.routeKey);
        return 'navigating';
      }

      // 3) 章节内任务点标签卡兜底
      const tab = this.nextTabItem();
      if (tab && getConfig().autoNext) {
        AppState.log('未找到【下一节】，尝试切换到当前章节的下一个任务点');
        skjHumanClick(tab.querySelector('a') || tab);
        this.jumpLock = Date.now() + 6000;
        return 'navigating';
      }

      // 4) 与参考扩展一致：没有可跳转的下一节 → 交由 drain 二次确认后判定课程完成
      return 'none';
    }

    /** 当前章节内下一个任务点标签卡（仅作为下一节按钮不可见时的兜底） */
    nextTabItem() {
      try {
        for (const doc of this.docs()) {
          const items = Array.from(doc.querySelectorAll('#prev_tab li, .prev_tab li'));
          if (items.length <= 1) continue;
          const activeIdx = items.findIndex(
            (li) => li.classList.contains('active') || li.classList.contains('curr') || li.classList.contains('on')
          );
          if (activeIdx < 0 || activeIdx >= items.length - 1) continue;
          return items[activeIdx + 1] || null;
        }
      } catch (e) {}
      return null;
    }

    /** 自动确认“任务点未完成”提示弹窗（与参考扩展同样的探测节奏） */
    handleJobFinishTip(expectedRouteKey = this.routeKey) {
      const check = () => {
        try {
          if (!this.va.active || this.routeKey !== expectedRouteKey) return;
          const currentRoute = CxDom.routeInfo();
          if (currentRoute && currentRoute.key !== expectedRouteKey) return;
          const tip = this.findVisible('.jobFinishTip');
          const btn = tip
            ? tip.querySelector('.popBottom .nextChapter, .popBottom a')
            : this.findVisible('.popBottom .nextChapter');
          if (!btn) return;
          skjLogOnce('cx-jobfinishtip', '检测到平台【任务点未完成】提示，已自动确认继续下一节', 'warn');
          skjHumanClick(btn);
        } catch (e) {}
      };
      [800, 2200, 4500, 9000].forEach((delay) => setTimeout(check, delay));
    }
  }

  /* =========================================================================
   * 5. 视频助手核心实现
   *    - 超星/学习通：委托 CxCourseRunner 任务点队列（对齐参考扩展）
   *    - 智慧树：小节列表驱动，优先跳转“未完成”视频
   *    - 智慧职教 / 中国大学MOOC / 学堂在线：通用媒体接管 + 下一节
   *    - 跨域子框架：仅接管本框架媒体并向顶层广播播放完成事件
   * ========================================================================= */

  class VideoAssistant {
    constructor() {
      this.timer = null;
      this.active = false;
      this.examAssist = null;
      this.cxRunner = new CxCourseRunner(this);

      this._jumpLock = 0;
      this._lifecycle = 0;
      this._lastHref = '';
      this._msgBound = false;
      this._zhsBridgeInjected = false;
      this._zhsCompleted = false;
    }

    setExamAssistant(examAssist) {
      this.examAssist = examAssist;
    }

    start() {
      if (this.active) return;
      this.active = true;
      if (skjIsTopFrame()) this.bindCrossFrameMessages();
      this.loop();
    }

    stop() {
      this.active = false;
      this._lifecycle += 1;
      this.cxRunner.cancelCurrent();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }

    /** 页面切换或手动触发：强制重新识别任务点 */
    kick() {
      if (!this.active) {
        this.start();
        return;
      }
      this.cxRunner.reset();
      this._lifecycle += 1;
      this._lastHref = location.href;
      this._zhsCompleted = false;
      this._jumpLock = 0;
      AppState.log('已重新识别当前页面任务点');
    }

    loop() {
      if (!this.active) return;
      const href = location.href;
      if (this._lastHref && this._lastHref !== href) this._lifecycle += 1;
      this._lastHref = href;
      const config = getConfig();
      try {
        if (skjIsTopFrame()) {
          if (Site.isChaoxing) this.tickChaoxing(config);
          else if (Site.isZhihuishu) this.tickZhihuishu(config);
          else this.tickGeneric(config);
        } else if (!skjCanReachTop()) {
          this.tickIsolatedFrame(config);
        }
      } catch (e) {
        AppState.log('运行异常: ' + (e && e.message ? e.message : e), 'error');
      }
      this.timer = setTimeout(() => this.loop(), 1500);
    }

    /* ---------------------------------------------------------------------
     * 平台分发
     * ------------------------------------------------------------------- */

    tickChaoxing(config) {
      if (Site.isCxStudentStudy) {
        if (!config.videoEnabled && !config.examEnabled) return;
        this.cxRunner.tick(config).catch((e) => {
          AppState.log('任务点执行异常: ' + (e && e.message ? e.message : e), 'error');
        });
        return;
      }
      if (Site.isCxWorkOrExam) return; // 独立作业/考试页由 ExamAssistant 处理
      this.tickGeneric(config);
    }

    tickZhihuishu(config) {
      if (config.videoEnabled) this.processMedia(document, config, { autoJump: false });
      if (config.autoSolveVideoQuiz) this.zhsSolvePopupQuiz(config);
      this.handlePauseArtifacts(document);

      if (!config.videoEnabled || !config.autoNext) return;
      if (this._zhsCompleted) return;
      if (Date.now() < this._jumpLock) return;

      const sections = this.zhsSections();
      if (!sections.length) return;
      const active = this.zhsActiveSection(sections);
      if (!active) return;

      const media = this.zhsCurrentVideo();
      const ended = media ? CxDom.isMediaFinished(media) : false;
      const done = this.zhsIsSectionDone(active) && config.skipFinished;
      if (!ended && !done) return;

      AppState.log(ended ? '当前视频已播放完毕' : '当前小节已完成');
      this.zhsNavigateNext(sections, active, config);
    }

    tickGeneric(config) {
      if (config.videoEnabled) this.processMedia(document, config, { autoJump: true });
      this.handlePauseArtifacts(document);
    }

    tickIsolatedFrame(config) {
      if (!config.videoEnabled) return;
      this.processMedia(document, config, { autoJump: false, notifyTop: true });
      this.handlePauseArtifacts(document);
    }

    bindCrossFrameMessages() {
      if (this._msgBound) return;
      this._msgBound = true;
      window.addEventListener('message', (event) => {
        const data = event && event.data;
        if (!data || data.type !== 'skj:media-ended' || !this.isTrustedMediaMessage(event)) return;
        const config = getConfig();
        if (!config.videoEnabled || !config.autoNext) return;
        AppState.log('子框架视频播放完成，准备跳转下一节...');
        this.scheduleGenericNext(2000);
      });
    }

    isTrustedMediaMessage(event) {
      if (!event || !event.source || event.source === window) return false;
      try {
        const matchedFrame = Array.from(document.querySelectorAll('iframe, frame')).some(
          (frame) => frame.contentWindow === event.source
        );
        if (matchedFrame) return true;
      } catch (e) {}
      try {
        const originHost = new URL(event.origin || '').hostname;
        const currentHost = location.hostname;
        return !!originHost &&
          (originHost === currentHost || originHost.endsWith('.' + currentHost) || currentHost.endsWith('.' + originHost));
      } catch (e) {
        return false;
      }
    }

    scheduleGenericNext(delay = 2500) {
      const lifecycle = this._lifecycle;
      const href = location.href;
      setTimeout(() => {
        if (!this.active || lifecycle !== this._lifecycle || location.href !== href) return;
        const config = getConfig();
        if (!config.videoEnabled || !config.autoNext) return;
        this.genericNavigateNext(config);
      }, delay);
    }

    /* ---------------------------------------------------------------------
     * 通用媒体接管
     * ------------------------------------------------------------------- */

    findMediaElements(root = document, seen = null) {
      const visited = seen || new Set();
      if (!root || visited.has(root)) return [];
      visited.add(root);
      let medias = [];
      try {
        medias = Array.from(root.querySelectorAll('video, audio'));
      } catch (e) {
        return [];
      }
      let frames = [];
      try {
        frames = Array.from(root.querySelectorAll('iframe, frame'));
      } catch (e) {}
      for (const fr of frames) {
        try {
          const win = fr.contentWindow;
          if (win) hookMediaWindow(win);
          const doc = fr.contentDocument || (win && win.document);
          if (doc) medias = medias.concat(this.findMediaElements(doc, visited));
        } catch (e) {
          // 跨域框架忽略
        }
      }
      return medias;
    }

    processMedia(root, config, options = {}) {
      const medias = this.findMediaElements(root);
      medias.forEach((media) => this.handleSingleMedia(media, config, options));
    }

    handleSingleMedia(media, config, options = {}) {
      if (!media) return;

      try {
        if (config.muted && !media.muted) media.muted = true;
      } catch (e) {}
      this.applyPlaybackRate(media, config.playbackRate);

      if (config.autoPlay && media.paused && !media.ended) {
        try {
          const p = media.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              try {
                media.muted = true;
                media.play().catch(() => {});
              } catch (e) {}
            });
          }
        } catch (e) {}
      }

      if (!media.dataset.skjEndedBound) {
        media.dataset.skjEndedBound = '1';
        media.addEventListener('ended', () => {
          media.dataset.skjEnded = '1';
          if (options.notifyTop) {
            this.notifyTopFrameMediaEnded();
            return;
          }
          if (!options.autoJump) return;
          // 实时读取最新配置，避免绑定时的旧值导致行为不一致
          const fresh = getConfig();
          if (!fresh.videoEnabled || !fresh.autoNext) return;
          AppState.log('当前视频播放完成，准备跳转下一节...');
          this.scheduleGenericNext(2500);
        });
      }

      // 兜底：部分平台 ended 事件被篡改，用进度判定
      if (options.autoJump && config.autoNext && !media.dataset.skjEnded && CxDom.isMediaFinished(media)) {
        media.dataset.skjEnded = '1';
        AppState.log('检测到视频播放至末尾，准备跳转下一节...');
        this.scheduleGenericNext(2500);
      } else if (options.notifyTop && !media.dataset.skjEnded && CxDom.isMediaFinished(media)) {
        media.dataset.skjEnded = '1';
        this.notifyTopFrameMediaEnded();
      }
    }

    notifyTopFrameMediaEnded() {
      try {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        win.top.postMessage({ type: 'skj:media-ended', href: location.href }, '*');
      } catch (e) {}
    }

    /**
     * 强制设置播放倍速（突破超星/学习通防倍速限制）
     */
    applyPlaybackRate(media, targetRate) {
      if (!media) return;
      const rate = Number(targetRate) || 1.0;
      let win = window;
      try {
        win = media.ownerDocument?.defaultView || window;
      } catch (e) {}
      try {
        hookMediaWindow(win);
      } catch (e) {}

      if (Math.abs(Number(media._skj_real_rate || 1.0) - rate) <= 0.05) return;

      let nativeDesc = null;
      try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow._skj_native_rate_desc) {
          nativeDesc = unsafeWindow._skj_native_rate_desc;
        }
      } catch (e) {}
      if (!nativeDesc) {
        try {
          nativeDesc = win._skj_native_rate_desc;
        } catch (e) {}
      }
      if (!nativeDesc) {
        try {
          nativeDesc = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'playbackRate');
        } catch (e) {}
      }

      media._skj_setting_real_rate = true;
      try {
        if (nativeDesc && nativeDesc.set) nativeDesc.set.call(media, rate);
        else media.playbackRate = rate;
        media._skj_real_rate = rate;
        skjLogOnce('rate-' + rate, `已开启 ${rate}x 倍速播放`);
      } catch (e) {
        try {
          media.playbackRate = rate;
          media._skj_real_rate = rate;
        } catch (e2) {}
      } finally {
        media._skj_setting_real_rate = false;
      }

      // 适配超星内部 Video.js 播放器实例
      try {
        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : win;
        if (pageWin && pageWin.videojs) {
          const players = pageWin.videojs.players || {};
          const p =
            players[media.id] || (typeof pageWin.videojs === 'function' ? pageWin.videojs(media) : null);
          if (p) {
            if (p.studyControl) {
              p.studyControl.enableSwitchWindow = 1;
              p.studyControl.enableFastForward = 1;
            }
            if (typeof p.playbackRate === 'function' && Math.abs((p.playbackRate() || 1.0) - rate) > 0.05) {
              try {
                p.playbackRate(rate);
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }

    /** 解除超星暂停遮罩 / 批注拦截 / 智慧树提醒弹窗（对齐参考扩展 handleVideoPauseArtifactsInIframe） */
    handlePauseArtifacts(root = document) {
      try {
        for (const doc of skjCollectDocs(root)) {
          const containers = Array.from(doc.querySelectorAll('.x-container-default'));
          const scopes = containers.length ? containers : [doc];
          for (const scope of scopes) {
            const pic = scope.querySelector('.sp_video_pic');
            if (pic) {
              const btn = pic.querySelector('a.jb_btn.jb_btn_92');
              if (btn && skjIsDisplayed(btn)) {
                skjHumanClick(btn);
                skjLogOnce('cx-resume-artifact', '已自动点击解除视频暂停遮罩');
                continue;
              }
            }
            const anno = scope.querySelector('.ans-videoannotation');
            if (anno) {
              const title = anno.querySelector('.comment_tit')?.innerText || '';
              if (title.includes('批注')) {
                const btn = anno.querySelector('.continueLearn');
                if (btn && skjIsDisplayed(btn)) {
                  skjHumanClick(btn);
                  skjLogOnce('cx-continue-learn', '已自动跳过超星批注拦截，继续播放');
                }
              }
            }
          }

          const zhsPopClose = doc.querySelector(
            '.courseRemind.khfaPop .el-icon-error, .courseRemind .el-icon-close, .courseRemind .close'
          );
          if (zhsPopClose && skjIsDeepVisible(zhsPopClose)) {
            skjHumanClick(zhsPopClose);
            skjLogOnce('zhs-course-remind', '已自动关闭智慧树弹窗提醒');
          }
        }
      } catch (e) {}
    }

    /* ---------------------------------------------------------------------
     * 超星视频随堂弹题（弹题）
     * ------------------------------------------------------------------- */

    async cxSolveVideoQuiz(taskIframe, config, attempt = 0) {
      let doc = null;
      try {
        doc = taskIframe.contentDocument;
      } catch (e) {}
      if (!doc) return 'none';

      const box = doc.querySelector('.ans-videoquiz');
      if (!box || !skjIsDeepVisible(box)) return 'none';

      const readBtn = (id) => doc.getElementById(id);
      const submitBtn = readBtn('videoquiz-submit');
      const continueBtn = readBtn('videoquiz-continue');
      const backBtn = readBtn('knowledgeBack');

      // 已经通过（出现继续/返回按钮）→ 点击恢复播放
      if (continueBtn && skjIsDisplayed(continueBtn)) {
        skjHumanClick(continueBtn);
        return 'resolved';
      }
      if (backBtn && skjIsDisplayed(backBtn)) {
        skjHumanClick(backBtn);
        return 'resolved';
      }
      if (box.dataset.skjSolving === '1') return 'busy';

      if (!String(config.openaiApiKey || '').trim()) {
        skjLogOnce('video-quiz-nokey', '检测到视频随堂弹题，但未配置 API Key，请手动作答', 'warn');
        return 'nokey';
      }

      box.dataset.skjSolving = '1';
      try {
        const typeTitle = doc.querySelector('.tkTopic_title')?.innerText || '';
        const questionType = /多选/.test(typeTitle)
          ? '多选题'
          : /判断/.test(typeTitle)
            ? '判断题'
            : '单选题';
        const stem = (doc.querySelector('.ans-videoquiz .tkTopic')?.innerText || box.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();
        const optEls = Array.from(doc.querySelectorAll('.ans-videoquiz-opt'));
        const options = optEls.map((el) => el.innerText.trim());
        if (!optEls.length) return 'none';

        let prompt = buildQuestionPrompt(questionType, stem, options);
        if (attempt > 0) {
          prompt += '\n【注意】上一次提交的答案被平台判定为错误，请重新仔细分析题目，务必给出正确的答案！';
        }
        const raw = await requestOpenAI(prompt, null, config);
        const answer = parseAnswerFromLLM(questionType, raw);
        AppState.log(`视频随堂弹题（${questionType}）AI 答案：${answer}`);

        if (questionType === '多选题') {
          optEls.forEach((el) => {
            const letter = skjLeadingLetter(el.innerText);
            const input = el.querySelector('input');
            const checked = !!(input && input.checked);
            const should = !!letter && String(answer).includes(letter);
            if (should !== checked) skjHumanClick(input || el);
          });
        } else {
          const target =
            optEls.find((el) => skjOptionMatches(el.innerText, answer)) || optEls[0];
          const input = target?.querySelector('input');
          if (input && !input.checked) skjHumanClick(input);
          else if (target) skjHumanClick(target);
        }

        await skjSleep(800);
        const freshSubmit = doc.getElementById('videoquiz-submit');
        if (freshSubmit && skjIsDisplayed(freshSubmit)) skjHumanClick(freshSubmit);
        await skjSleep(2000);

        // 与参考扩展一致：用 #spanNot / #spanNotBackPoint 判定答案是否错误
        const continueBtn2 = doc.getElementById('videoquiz-continue');
        const backBtn2 = doc.getElementById('knowledgeBack');
        const submitBtn2 = doc.getElementById('videoquiz-submit');
        const notBack = doc.getElementById('spanNotBackPoint');
        const notOk = doc.getElementById('spanNot');
        const wrongVisible =
          (!!notBack && skjDisplayOf(notBack) === 'block') || (!!notOk && skjDisplayOf(notOk) === 'block');

        if (continueBtn2 && skjIsDisplayed(continueBtn2)) {
          skjHumanClick(continueBtn2);
          AppState.log('视频随堂弹题已通过，继续播放');
          return 'resolved';
        }
        if (wrongVisible && submitBtn2 && skjIsDisplayed(submitBtn2)) return 'retry';
        if (wrongVisible && backBtn2 && skjIsDisplayed(backBtn2)) {
          skjHumanClick(backBtn2);
          AppState.log('视频随堂弹题已通过，继续播放');
          return 'resolved';
        }
        AppState.log('视频随堂弹题已提交');
        return 'resolved';
      } catch (e) {
        AppState.log('视频随堂弹题求解失败: ' + (e && e.message ? e.message : e), 'error');
        return 'failed';
      } finally {
        setTimeout(() => {
          try {
            box.dataset.skjSolving = '';
          } catch (e) {}
        }, 3000);
      }
    }

    /* ---------------------------------------------------------------------
     * 智慧树
     * ------------------------------------------------------------------- */

    zhsSections() {
      try {
        const modern = Array.from(document.querySelectorAll('li.video'));
        if (modern.length) return modern;
        return Array.from(
          document.querySelectorAll('.inner-li li.clearfix.video, .resources-list .resources-item')
        );
      } catch (e) {
        return [];
      }
    }

    zhsActiveSection(sections) {
      const list = sections || this.zhsSections();
      return (
        list.find(
          (el) =>
            el.classList.contains('current_play') ||
            el.classList.contains('activeNode') ||
            el.classList.contains('active')
        ) || null
      );
    }

    zhsSectionKey(el) {
      if (!el) return '';
      return (
        el.getAttribute('data-id') ||
        el.getAttribute('data-video-id') ||
        el.getAttribute('data-file-id') ||
        el.id ||
        el.querySelector('.catalogue_title')?.innerText?.trim() ||
        ''
      );
    }

    zhsIsSectionDone(el) {
      try {
        return !!el.querySelector('.time_icofinish, .finish-icon, .icon-finish');
      } catch (e) {
        return false;
      }
    }

    /** 优先返回后续“未完成”的小节（对齐参考扩展 findNextSectionElement） */
    zhsFindNext(sections, fromIndex, preferUnfinished) {
      const rest = sections.slice(fromIndex + 1);
      if (!rest.length) return null;
      if (preferUnfinished) return rest.find((el) => !this.zhsIsSectionDone(el)) || null;
      return rest[0] || null;
    }

    zhsCurrentVideo() {
      try {
        return document.querySelector('#vjs_container_html5_api') || document.querySelector('video');
      } catch (e) {
        return null;
      }
    }

    zhsNavigateNext(sections, active, config) {
      if (Date.now() < this._jumpLock) return;
      const list = sections || this.zhsSections();
      const current = active || this.zhsActiveSection(list);
      const idx = current ? list.indexOf(current) : -1;
      if (idx < 0) return;

      const next = this.zhsFindNext(list, idx, !!config.skipFinished);
      if (!next) {
        this._zhsCompleted = true;
        this.markCourseComplete('智慧树');
        return;
      }

      AppState.log(`切换至智慧树下一个未完成小节（第 ${list.indexOf(next) + 1} 个）`);
      skjHumanClick(next);
      this._jumpLock = Date.now() + 6000;

      // 与参考扩展一致：3 秒后若仍未切换成功则重试一次
      const key = this.zhsSectionKey(current);
      const lifecycle = this._lifecycle;
      const href = location.href;
      setTimeout(() => {
        if (!this.active || lifecycle !== this._lifecycle || location.href !== href) return;
        const nowActive = this.zhsActiveSection();
        if (nowActive && this.zhsSectionKey(nowActive) === key) {
          const again = this.zhsFindNext(this.zhsSections(), this.zhsSections().indexOf(nowActive), !!config.skipFinished);
          if (again) {
            AppState.log('智慧树小节未切换成功，正在重试...', 'warn');
            skjHumanClick(again);
          }
        }
      }, 3200);
    }

    /** 智慧树视频弹题（#playTopic-dialog） */
    zhsSolvePopupQuiz(config) {
      let dialog = null;
      try {
        dialog = document.querySelector('#playTopic-dialog');
      } catch (e) {}
      if (!dialog || !skjIsDeepVisible(dialog)) return;

      if (this.zhsAnswerPopupQuizDirect(dialog)) return;
      this.ensureZhsQuizBridge();
    }

    /** 直接读取 Vue 实例作答（脚本管理器运行在页面上下文时可用） */
    zhsAnswerPopupQuizDirect(dialog) {
      try {
        const vue = dialog.__vue__?.$parent?.$parent;
        const info = vue?.topicInfo?.lessonTestQuestionUseInterfaceDtos?.[0];
        const options = info?.testQuestion?.questionOptions;
        const answers = info?.answerUs;
        if (!vue || !options?.length || !answers?.length || typeof vue.topicClickQot !== 'function') {
          return false;
        }
        const key = String(info?.testQuestion?.id || answers.join(''));
        if (dialog.dataset.skjQuizKey === key) return true;
        dialog.dataset.skjQuizKey = key;

        const matched = options.filter((o) => o.sortUs && answers.includes(o.sortUs));
        matched.forEach((opt, i) => {
          setTimeout(() => {
            try {
              vue.topicClickQot(opt);
            } catch (e) {}
          }, 500 * i);
        });
        setTimeout(
          () => {
            try {
              vue.testDialog = false;
            } catch (e) {}
            AppState.log('智慧树视频弹题已自动作答并关闭');
          },
          Math.max(1200, 500 * matched.length + 800)
        );
        return true;
      } catch (e) {
        return false;
      }
    }

    ensureZhsQuizBridge() {
      if (this._zhsBridgeInjected) return;
      this._zhsBridgeInjected = true;
      skjLogOnce('zhs-quiz-bridge', '检测到智慧树视频弹题，正在尝试自动作答...');
      const code = `(${zhsQuizBridge.toString()})();`;
      try {
        if (typeof GM_addElement === 'function') {
          GM_addElement(document.documentElement, 'script', { textContent: code });
          return;
        }
      } catch (e) {}
      try {
        const s = document.createElement('script');
        s.textContent = code;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (e) {
        AppState.log('智慧树弹题自动作答桥接注入失败（可能被 CSP 拦截），请手动完成弹题', 'warn');
      }
    }

    /* ---------------------------------------------------------------------
     * 其他平台：下一节跳转
     * ------------------------------------------------------------------- */

    genericNavigateNext(config) {
      if (Date.now() < this._jumpLock) return;
      if (Site.isIcve) return this.icveNavigateNext(config);
      if (Site.isMooc) return this.moocNavigateNext(config);
      if (Site.isXuetang) return this.xuetangNavigateNext(config);
      this.markCourseComplete('当前平台');
    }

    icveNavigateNext(config) {
      const nodes = Array.from(document.querySelectorAll('.panelList .node'));
      if (!nodes.length) return;
      const active = nodes.find((el) => el.classList.contains('active')) || null;
      const idx = active ? nodes.indexOf(active) : -1;
      const isDone = (el) =>
        el.classList.contains('is-finish') || !!el.querySelector('.icon-finish, .finish, .is-finish');
      let next = null;
      if (idx >= 0 && idx < nodes.length - 1) {
        const rest = nodes.slice(idx + 1);
        next = (config.skipFinished && rest.find((el) => !isDone(el))) || rest[0] || null;
      }
      if (!next) return this.markCourseComplete('智慧职教');
      AppState.log('跳转至智慧职教下一个学习单元');
      skjHumanClick(next);
      this._jumpLock = Date.now() + 6000;
    }

    moocNavigateNext(config) {
      const lessons = Array.from(document.querySelectorAll('.j-item, .lesson-item, .unit-item'));
      const active =
        lessons.find((el) => el.classList.contains('active') || el.classList.contains('current')) || null;
      if (active) {
        const isDone = (el) => !!el.querySelector('.u-icon-finish, .j-icon-finish, .icon-finish');
        const rest = lessons.slice(lessons.indexOf(active) + 1);
        const next = (config.skipFinished && rest.find((el) => !isDone(el))) || rest[0] || null;
        if (next) {
          AppState.log('跳转至中国大学MOOC下一个课时');
          skjHumanClick(next.querySelector('a') || next);
          this._jumpLock = Date.now() + 6000;
          return;
        }
      }
      const btn = document.querySelector('.u-btn.u-btn-default.f-fr, .next-lesson, .btn-next');
      if (btn && skjIsDisplayed(btn)) {
        AppState.log('点击中国大学MOOC【下一讲】');
        skjHumanClick(btn);
        this._jumpLock = Date.now() + 6000;
        return;
      }
      this.markCourseComplete('中国大学MOOC');
    }

    xuetangNavigateNext(config) {
      const btn = document.querySelector(
        'a.next-section, .next-unit, .btn-next, .next-btn, [class*="next-section"], [class*="nextUnit"]'
      );
      if (btn && skjIsDisplayed(btn)) {
        AppState.log('点击学堂在线【下一节】');
        skjHumanClick(btn);
        this._jumpLock = Date.now() + 6000;
        return;
      }
      this.markCourseComplete('学堂在线');
    }

    markCourseComplete(platformName) {
      const known = platformName !== '当前平台';
      AppState.setStatus(known ? '课程已全部完成' : '已停止自动跳转');
      skjLogOnce(
        'course-complete-' + platformName,
        known
          ? `🎉 未检测到下一节，${platformName} 课程已全部学习完成，已停止自动跳转`
          : '⚠️ 未能识别到下一节入口，已停止自动连播（若课程尚未学完请手动跳转）'
      );
      this.stopAllMedia();
    }

    /** 仅暂停“已播放完毕”的媒体，避免影响用户主动观看 */
    stopAllMedia() {
      try {
        this.findMediaElements(document).forEach((media) => {
          if (!media.paused && CxDom.isMediaFinished(media)) {
            try {
              media.pause();
            } catch (e) {}
          }
        });
      } catch (e) {}
    }

    /* ---------------------------------------------------------------------
     * 兼容旧接口（UI 面板 / index.js）
     * ------------------------------------------------------------------- */

    /** @deprecated 保留兼容：判定当前任务点是否已完成 */
    isTaskPointFinished() {
      if (Site.isChaoxing) {
        const doc = CxDom.studyDoc();
        if (!doc) return false;
        const tasks = CxDom.listTasks(doc) || [];
        return tasks.some((t) => CxDom.hasDoneKnowledge(CxDom.taskIframeOf(doc, t)));
      }
      if (Site.isZhihuishu) {
        const sections = this.zhsSections();
        const active = this.zhsActiveSection(sections);
        return !!active && this.zhsIsSectionDone(active);
      }
      if (Site.isIcve) {
        const active = document.querySelector('.panelList .node.active');
        return !!active && (active.classList.contains('is-finish') || !!active.querySelector('.icon-finish, .finish'));
      }
      return false;
    }

    /** @deprecated 保留兼容：章节测验是否已完成 */
    isChapterQuizComplete(doc) {
      const status = CxDom.workStatus(doc);
      return status === 'complete' || status === 'pendingReview';
    }

    /** @deprecated 保留兼容：立即检测并解答章节测验 */
    checkAndSolveChapterQuiz(config) {
      if (!Site.isCxStudentStudy) return;
      this.kick();
    }

    /** 手动/自动触发下一节 */
    triggerNextChapter() {
      if (Date.now() < this._jumpLock) return;
      const config = getConfig();
      if (Site.isChaoxing && Site.isCxStudentStudy) {
        if (this.cxRunner.running) this.cxRunner.cancelCurrent();
        this.cxRunner.drainedAt = 0;
        this.cxRunner.drainRetry = 0;
        this.cxRunner.drain(config).catch(() => {});
        return;
      }
      if (Site.isZhihuishu) {
        const sections = this.zhsSections();
        const active = this.zhsActiveSection(sections);
        if (active) this.zhsNavigateNext(sections, active, config);
        else this.markCourseComplete('智慧树');
        return;
      }
      this.genericNavigateNext(config);
    }
  }

  /* =========================================================================
   * 智慧树视频弹题页面上下文桥接（对齐参考扩展 MAIN world 方案）
   * 该函数会被序列化后注入页面上下文执行，不可引用闭包变量
   * ========================================================================= */
  function zhsQuizBridge() {
    var TOKEN = 'data-skj-zhs-quiz-key';
    var warned = false;
    setInterval(function () {
      try {
        var dialog = document.querySelector('#playTopic-dialog');
        if (!dialog) return;
        var st = window.getComputedStyle(dialog);
        if (!st || st.display === 'none' || st.visibility === 'hidden') return;
        var vue = dialog.__vue__ && dialog.__vue__.$parent && dialog.__vue__.$parent;
        var info = vue && vue.topicInfo && vue.topicInfo.lessonTestQuestionUseInterfaceDtos;
        var dto = info && info[0];
        var options = dto && dto.testQuestion && dto.testQuestion.questionOptions;
        var answers = dto && dto.answerUs;
        if (!vue || !options || !options.length || !answers || !answers.length) return;
        var key = String((dto.testQuestion && (dto.testQuestion.id || dto.testQuestion.questionId)) || answers.join(''));
        if (dialog.getAttribute(TOKEN) === key) return;
        dialog.setAttribute(TOKEN, key);

        var matched = [];
        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          if (opt && opt.sortUs && answers.indexOf(opt.sortUs) >= 0) matched.push(opt);
        }
        matched.forEach(function (opt, idx) {
          setTimeout(function () {
            try {
              if (typeof vue.topicClickQot === 'function') vue.topicClickQot(opt);
            } catch (e) {}
          }, 500 * idx);
        });
        setTimeout(
          function () {
            try {
              vue.testDialog = false;
            } catch (e) {}
          },
          Math.max(1200, 500 * matched.length + 800)
        );
      } catch (e) {
        if (!warned) {
          warned = true;
          try {
            console.warn('[刷课酱] 智慧树弹题桥接异常', e);
          } catch (e2) {}
        }
      }
    }, 1500);
  }

  /* =========================================================================
   * 6. AI 解题助手核心实现
   *    - 超星章节测验：定位 #iframe → work 任务框架 → #frame_content → 题目文档
   *    - 超星作业/考试页：.questionLi / .answerBg / .num_option 体系
   *    - 智慧树 作业/考试页
   *    - 作答后按参考扩展流程：暂存 → 提交 → 结果弹窗校验（未做完/未及格自动取消）
   * ========================================================================= */

  class ExamAssistant {
    constructor(videoAssist = null) {
      this.videoAssist = videoAssist;
      this.isBusy = false;
      this.workPromise = null;
    }

    setVideoAssistant(videoAssist) {
      this.videoAssist = videoAssist;
    }

    get video() {
      return this.videoAssist;
    }

    /** 自动检测当前页面类型并启动答题流程 */
    async solveCurrentPage(manual = false) {
      if (this.isBusy) {
        AppState.log('解题任务正在运行中，请稍候...', 'warn');
        return;
      }
      const config = getConfig();
      if (!config.examEnabled && !manual) return;
      if (!String(config.openaiApiKey || '').trim()) {
        AppState.log('请先在控制台中配置 AI 接口（Base URL / API Key / 模型）后再自动答题', 'error');
        return;
      }

      this.isBusy = true;
      AppState.isSolvingQuiz = true;
      AppState.setStatus('正在解析页面题目...');
      try {
        if (Site.isChaoxing) {
          if (await this.solveChaoxingWork(config, manual)) return;
          if (await this.solveChaoxingQuestionLiPage(config, manual)) return;
        }
        if (Site.isZhihuishu) {
          if (await this.solveZhihuishuExamPage(config, manual)) return;
        }
        AppState.log('当前页面未检测到可解答的题目', 'warn');
      } catch (err) {
        AppState.log('答题异常: ' + (err && err.message ? err.message : err), 'error');
      } finally {
        this.isBusy = false;
        AppState.isSolvingQuiz = false;
        AppState.setStatus('空闲');
      }
    }

    /* =====================================================================
     * 超星章节测验
     * =================================================================== */

    /** 学习页中的测验任务点（兼容旧接口名） */
    async solveChaoxingChapterTest(config) {
      return this.solveChaoxingWork(config, false);
    }

    async solveChaoxingWork(config, allowDisabled = false) {
      if (!Site.isCxStudentStudy) return false;
      const studyDoc = CxDom.studyDoc();
      if (!studyDoc) return false;
      const tasks = CxDom.listTasks(studyDoc);
      if (!tasks) return false;
      const workTask = tasks.find((t) => t.type === 'work');
      if (!workTask) return false;
      const iframe = CxDom.taskIframeOf(studyDoc, workTask);
      if (!iframe) return false;

      const doc = await skjWaitFor(() => CxDom.workDoc(iframe), { timeout: 20000, interval: 500 });
      if (!doc) return false;
      await this.solveCxWorkDoc(doc, config, { allowDisabled });
      return true;
    }

    /**
     * 解答一个超星章节测验文档
     * @returns {{status:'done'|'failed', reason:string, submitSafe:boolean}}
     */
    async solveCxWorkDoc(doc, config, options = {}) {
      if (this.workPromise) return this.workPromise;
      const promise = this.runCxWorkDoc(doc, config, options);
      this.workPromise = promise;
      try {
        return await promise;
      } finally {
        if (this.workPromise === promise) this.workPromise = null;
      }
    }

    async runCxWorkDoc(doc, config, options = {}) {
      const cancelled = typeof options.cancelled === 'function' ? options.cancelled : () => false;
      const respectEnabled = !options.allowDisabled;
      const status = CxDom.workStatus(doc);
      if (status === 'complete' || status === 'pendingReview' || status === 'teacherIncomplete') {
        AppState.log(`当前章节测验状态：${status}，无需作答`);
        return { status: 'done', reason: status, submitSafe: true };
      }

      // 超星字体混淆（font-cxsecret）会把题干文字替换为图形字体，识别结果不可靠，宁可不答也不乱答
      if (CxDom.hasFontObfuscation(doc)) {
        AppState.log('该测验启用了超星字体混淆，为避免提交错误答案已跳过自动作答，请手动完成', 'warn');
        return { status: 'done', reason: 'font_obfuscated', submitSafe: false };
      }

      const questions = Array.from(doc.querySelectorAll('#ZyBottom .singleQuesId'));
      if (!questions.length) {
        AppState.log('当前测验未识别到题目，已暂存后跳过', 'warn');
        await this.saveCxWork(doc, { submit: false });
        return { status: 'done', reason: 'no_question', submitSafe: false };
      }

      AppState.log(`检测到章节测验，共 ${questions.length} 道题，开始 AI 作答...`);
      let ok = 0;
      let failed = 0;

      for (let i = 0; i < questions.length; i++) {
        if (cancelled() || (respectEnabled && !getConfig().examEnabled)) {
          return { status: 'paused', reason: 'cancelled', submitSafe: false };
        }
        const qEl = questions[i];
        AppState.setStatus(`正在解答章节测验 ${i + 1}/${questions.length}...`);
        try {
          const questionType = this.getCxQuestionType(qEl);
          const { stem, options, optEls } = this.extractCxQuestion(qEl, questionType);
          const prompt = buildQuestionPrompt(questionType, stem, options);
          const raw = await requestOpenAI(prompt, null, config);
          if (cancelled() || (respectEnabled && !getConfig().examEnabled)) {
            return { status: 'paused', reason: 'cancelled', submitSafe: false };
          }
          const answer = parseAnswerFromLLM(questionType, raw);
          AppState.log(`[测验 ${i + 1}/${questions.length}] ${questionType} → ${answer}`);
          const filled = this.fillCxQuestion(qEl, questionType, answer, optEls);
          if (filled) ok += 1;
          else failed += 1;
        } catch (err) {
          failed += 1;
          AppState.log(`[测验 ${i + 1}/${questions.length}] 作答失败: ${err.message}`, 'error');
        }
        await skjSleep(Math.max(800, Number(config.solveInterval) || 1500));
      }

      AppState.log(`章节测验作答完成：成功 ${ok} 题${failed ? `，失败 ${failed} 题` : ''}`);
      if (cancelled() || (respectEnabled && !getConfig().examEnabled)) {
        return { status: 'paused', reason: 'cancelled', submitSafe: false };
      }

      const liveConfig = getConfig();
      if (liveConfig.autoSubmit && failed === 0) {
        const reason = await this.saveCxWork(doc, {
          submit: true,
          cancelled
        });
        if (reason === 'cancelled') return { status: 'paused', reason, submitSafe: false };
        return { status: 'done', reason, submitSafe: reason === 'submitted' };
      }
      await this.saveCxWork(doc, { submit: false, cancelled });
      return {
        status: 'done',
        reason: failed ? `partial_saved(${failed}题未完成)` : 'saved',
        submitSafe: false
      };
    }

    /** 识别章节测验题目类型 */
    getCxQuestionType(qEl) {
      const TYPE_MAP = {
        0: '单选题',
        1: '多选题',
        2: '填空题',
        3: '判断题',
        4: '简答题',
        5: '名词解释',
        6: '论述题',
        7: '计算题',
        8: '其他题',
        9: '分录题',
        10: '资料题',
        11: '连线题',
        14: '完形填空',
        15: '阅读理解'
      };
      try {
        const val = qEl.querySelector('input[id^="answertype"]')?.value;
        const num = parseInt(val, 10);
        if (!Number.isNaN(num) && TYPE_MAP[num]) return TYPE_MAP[num];
      } catch (e) {}
      const title = qEl.querySelector('.Zy_TItle')?.innerText || qEl.innerText || '';
      const m = title.match(/【([^】]+题)】/);
      return m ? m[1] : '单选题';
    }

    /** 提取章节测验题干与选项 */
    extractCxQuestion(qEl, questionType) {
      const isMulti = questionType === '多选题';
      let optEls = Array.from(qEl.querySelectorAll(isMulti ? '.before-after-checkbox' : '.before-after'));
      if (!optEls.length) optEls = Array.from(qEl.querySelectorAll('.before-after, .before-after-checkbox'));
      const stemEl = qEl.querySelector('.Zy_TItle');
      const stem = ((stemEl ? stemEl.innerText : qEl.innerText) || '')
        .replace(/【[^】]*】/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const options = optEls.map((el) => el.innerText.trim());
      return { stem, options, optEls };
    }

    /** 按题型填入章节测验答案 */
    fillCxQuestion(qEl, questionType, answer, optEls, doc) {
      const list = optEls && optEls.length ? optEls : Array.from(qEl.querySelectorAll('.before-after, .before-after-checkbox'));

      if (questionType === '单选题') {
        const target = list.find((el) => skjOptionMatches(el.innerText, answer));
        if (!target) return false;
        const input = target.querySelector('[name^=answer]');
        if (input && (input.classList.contains('check_answer') || input.classList.contains('check_answer_dx'))) {
          return true;
        }
        skjHumanClick(target.closest('.before-after') || target);
        return true;
      }

      if (questionType === '多选题') {
        let hit = false;
        list.forEach((el) => {
          const input = el.querySelector('[name^=answercheck]') || el.querySelector('input');
          // 与参考扩展一致：以选项容器（或答案输入元）上的字母作为选项标识
          const letter =
            skjLeadingLetter(el.innerText) ||
            (input ? (input.innerText || '').trim() || String(input.value || '').trim() : '');
          const checked = !!(
            input &&
            (input.classList.contains('check_answer') ||
              input.classList.contains('check_answer_dx') ||
              input.checked)
          );
          const should = !!letter && String(answer).toUpperCase().includes(String(letter).toUpperCase());
          if (should) hit = true;
          if (should !== checked) skjHumanClick(input || el);
        });
        return hit;
      }

      if (questionType === '判断题') {
        const ans = String(answer);
        const target =
          list.find((el) => {
            const text = el.innerText.trim();
            return text.includes(ans.charAt(0));
          }) || list[0];
        if (!target) return false;
        const input = target.querySelector('[name^=answer]');
        if (input && (input.classList.contains('check_answer') || input.classList.contains('check_answer_dx'))) {
          return true;
        }
        skjHumanClick(target.closest('.before-after') || target);
        return true;
      }

      if (questionType === '填空题' || questionType === '分录题' || questionType === '资料题' || questionType === '完形填空') {
        const blanks = Array.from(qEl.querySelectorAll('.blankItemDiv'));
        if (!blanks.length) return false;
        const parts = String(answer).split('#');
        blanks.forEach((blank, i) => {
          const value = (parts[i] || parts[0] || '').trim();
          const textarea = blank.querySelector('textarea');
          const inpDiv = blank.querySelector('.InpDIV');
          const editor = blank.querySelector('iframe');
          if (textarea) {
            textarea.value = value;
            skjFireInput(textarea);
          }
          if (inpDiv) inpDiv.innerHTML = `<p>${skjEscapeHtml(value)}</p>`;
          try {
            const body = editor?.contentDocument?.body?.querySelector('p');
            if (body) body.innerHTML = skjEscapeHtml(value);
          } catch (e) {}
        });
        return true;
      }

      if (questionType === '连线题') {
        return this.fillCxLineAnswer(qEl, answer);
      }

      // 简答题 / 名词解释 / 论述题 / 计算题 / 其他题 / 阅读理解
      const value = String(answer).replace(/^#+|#+$/g, '').replace(/#+/g, ',');
      let filled = false;
      const textarea = qEl.querySelector('.Zy_ulTk li textarea, .Zy_ulTk textarea, .Zy_TItle textarea');
      if (textarea) {
        textarea.value = value;
        skjFireInput(textarea);
        filled = true;
      }
      try {
        const body = qEl.querySelector('.Zy_ulTk iframe')?.contentDocument?.body?.querySelector('p');
        if (body) {
          body.innerHTML = skjEscapeHtml(value);
          filled = true;
        }
      } catch (e) {}
      return filled;
    }

    /** 连线题填入 */
    fillCxLineAnswer(qEl, answer) {
      const list = qEl.querySelector('.beautiSelect .thirdUlList');
      if (!list) return false;
      const parts = String(answer).split(/[\n,]/);
      parts.forEach((part, i) => {
        setTimeout(() => {
          const clean = part.replace(/[-、\s.#]/g, '');
          const m = clean.match(/(\d+)([A-Za-z]+)/);
          if (!m) return;
          const li = list.querySelector(`li[index="${m[1]}"]`);
          if (!li) return;
          const option = li.querySelector(`[value="${m[2]}"]`);
          const label = li.querySelector('.chosen-single span');
          if (option) {
            option.selected = true;
            if (label) label.innerText = m[2];
          }
        }, 50 * i);
      });
      return true;
    }

    /* =====================================================================
     * 超星 暂存 / 提交 / 结果校验
     * =================================================================== */

    collectDocs(extra = []) {
      return skjCollectDocs(document).concat(extra.filter(Boolean));
    }

    findVisiblePopup(extra = []) {
      const docs = this.collectDocs(extra);
      for (const selector of ['#workpop', '#workpopFocus', '.workpop', '#popup_container']) {
        for (const doc of docs) {
          try {
            const el = doc.querySelector(selector);
            if (el && skjIsDisplayed(el)) return el;
          } catch (e) {}
        }
      }
      return null;
    }

    /** 提交后的二级结果弹窗（#workpopFocus） */
    findFocusPopup(extra = []) {
      const docs = this.collectDocs(extra);
      for (const doc of docs) {
        try {
          const el = doc.getElementById('workpopFocus');
          if (el && skjIsDisplayed(el)) return el;
        } catch (e) {}
      }
      return null;
    }

    readPopupContent(extra = []) {
      const docs = this.collectDocs(extra);
      for (const selector of ['#popcontent', '.popcontent', '.popBottom .content']) {
        const el = skjQueryDocs(docs, selector);
        if (el) return el.innerText || '';
      }
      return '';
    }

    clickPopupButton(extra = [], selector = '') {
      const docs = this.collectDocs(extra);
      const el = skjQueryDocs(docs, selector);
      if (!el) return false;
      skjHumanClick(el);
      return true;
    }

    /**
     * 章节测验暂存 / 提交
     * @returns 'saved'|'submitted'|'submitted_unverified'|'incomplete'|'nopass'|'error'
     */
    async saveCxWork(doc, options = {}) {
      const submit = !!options.submit;
      const cancelled = typeof options.cancelled === 'function' ? options.cancelled : () => false;
      try {
        if (cancelled()) return 'cancelled';
        // 1) 暂存答案
        const subBar = doc.querySelector('.ZY_sub.clearfix, .ZY_sub');
        if (subBar) skjHumanClick(subBar);
        const saveBtn = doc.querySelector('.btnSave.workBtnIndex, .ZY_sub .btnSave, .btnSave');
        if (saveBtn) {
          skjHumanClick(saveBtn);
          AppState.log('已暂存章节测验答案');
        }
        await skjSleep(1200);
        if (cancelled()) return 'cancelled';
        if (!submit) return 'saved';

        // 2) 提交
        const submitBtn = doc.querySelector('.btnSubmit.workBtnIndex, .btnSubmit');
        if (!submitBtn) {
          AppState.log('未找到测验提交按钮，已保留暂存结果', 'warn');
          return 'saved';
        }
        skjHumanClick(submitBtn);

        // 3) 结果弹窗判定（对齐参考扩展：未做完 / 未达到及格线 自动取消）
        const popup = await skjWaitFor(() => this.findVisiblePopup([doc]), {
          timeout: 8000,
          interval: 250,
          cancelled
        });
        if (popup) {
          const content = this.readPopupContent([doc]);
          if (content.includes('未做完')) {
            this.clickPopupButton([doc], '#popno, .popno');
            AppState.log('平台提示仍有未作答题目，已取消提交（答案已暂存）', 'warn');
            return 'incomplete';
          }
          if (content.includes('未达到及格线')) {
            this.clickPopupButton([doc], '#popno, .popno');
            AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
            return 'nopass';
          }
          this.clickPopupButton([doc], '#popok, .popok');
          AppState.log('已自动确认提交章节测验');

          // 3.1 二级结果弹窗（#workpopFocus）：未达到及格线时同样取消提交
          const focusPopup = await skjWaitFor(() => this.findFocusPopup([doc]), {
            timeout: 6000,
            interval: 300,
            cancelled
          });
          if (focusPopup) {
            const focusText = this.readPopupContent([doc]);
            if (focusText.includes('未达到及格线')) {
              this.clickPopupButton([doc], '#popno, .popno');
              AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
              return 'nopass';
            }
            this.clickPopupButton([doc], '#popok, .popok');
          }
        } else {
          AppState.log('未检测到提交确认弹窗（可能已直接提交）', 'warn');
        }

        // 4) 校验结果视图
        const verified = await skjWaitFor(
          () =>
            CxDom.isWorkResultView(doc) ||
            ['complete', 'pendingReview', 'teacherIncomplete'].includes(CxDom.workStatus(doc)),
          { timeout: 12000, interval: 500, cancelled }
        );
        if (cancelled()) return 'cancelled';
        return verified ? 'submitted' : 'submitted_unverified';
      } catch (err) {
        AppState.log('暂存/提交异常: ' + err.message, 'error');
        return 'error';
      }
    }

    /* =====================================================================
     * 超星 独立作业 / 考试页（.questionLi）
     * =================================================================== */

    /** 题型识别（作业页） */
    detectQuestionLiType(qEl) {
      const title = qEl.querySelector('.mark_name .colorShallow, h3, .Zy_TItle')?.innerText || '';
      const list = [
        '单选题',
        '多选题',
        '判断题',
        '填空题',
        '简答题',
        '名词解释',
        '论述题',
        '计算题',
        '分录题',
        '资料题',
        '连线题',
        '其他题'
      ];
      const hit = list.find((t) => title.includes(t));
      if (hit) return hit;
      const m = (title + qEl.innerText).match(/【([^】]+题)】/);
      return m ? m[1] : '单选题';
    }

    async solveChaoxingQuestionLiPage(config, allowDisabled = false) {
      const questions = Array.from(document.querySelectorAll('.questionLi'));
      if (!questions.length) return false;

      AppState.log(`检测到超星作业/考试页面，共 ${questions.length} 道题`);
      let ok = 0;
      let failed = 0;

      for (let i = 0; i < questions.length; i++) {
        if (!allowDisabled && !getConfig().examEnabled) {
          AppState.log('AI 解题助手已关闭，已停止继续处理作业/考试', 'warn');
          return true;
        }
        const qEl = questions[i];
        AppState.setStatus(`正在解答作业/考试 ${i + 1}/${questions.length}...`);
        try {
          const questionType = this.detectQuestionLiType(qEl);
          const stemEl = qEl.querySelector('.mark_name .qtContent, h3, .Zy_TItle');
          const stem = ((stemEl ? stemEl.innerText : qEl.innerText) || '')
            .replace(/【[^】]*】/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const optEls = Array.from(qEl.querySelectorAll('.answerBg'));
          const options = optEls.map((el) => el.innerText.trim());
          const prompt = buildQuestionPrompt(questionType, stem, options);
          const raw = await requestOpenAI(prompt, null, config);
          const answer = parseAnswerFromLLM(questionType, raw);
          AppState.log(`[作业 ${i + 1}/${questions.length}] ${questionType} → ${answer}`);
          const filled = this.fillQuestionLiAnswer(qEl, questionType, answer, optEls);
          if (filled) ok += 1;
          else failed += 1;
        } catch (err) {
          failed += 1;
          AppState.log(`[作业 ${i + 1}/${questions.length}] 作答失败: ${err.message}`, 'error');
        }
        await skjSleep(Math.max(800, Number(config.solveInterval) || 1500));
      }

      AppState.log(`作业/考试作答完成：成功 ${ok} 题${failed ? `，失败 ${failed} 题` : ''}`);
      await this.saveQuestionLiPage(config, failed, allowDisabled);
      return true;
    }

    /** 填入 .questionLi 结构答案（对齐参考扩展 cxExam 的填入逻辑） */
    fillQuestionLiAnswer(qEl, questionType, answer, optEls) {
      const list = optEls && optEls.length ? optEls : Array.from(qEl.querySelectorAll('.answerBg'));
      try {
        qEl.scrollIntoView({ block: 'center' });
      } catch (e) {}

      if (questionType.includes('单选')) {
        const idx = list.findIndex((el, n) => {
          const text = (list[n]?.innerText || '').trim();
          return skjOptionMatches(text, answer) || text === String(answer).trim();
        });
        if (idx < 0) return false;
        const icon = list[idx].querySelector('.num_option');
        if (icon && icon.classList.contains('check_answer')) return true;
        skjHumanClick(icon || list[idx]);
        return true;
      }

      if (questionType.includes('多选')) {
        let hit = false;
        list.forEach((el, n) => {
          const icon = el.querySelector('.num_option_dx') || el.querySelector('.num_option');
          if (!icon) return;
          const label = (icon.innerText || '').trim();
          const should = !!label && String(answer).includes(label);
          const checked = icon.classList.contains('check_answer_dx') || icon.classList.contains('check_answer');
          if (should) hit = true;
          if (should !== checked) setTimeout(() => skjHumanClick(icon), 500 * n);
        });
        return hit;
      }

      if (questionType.includes('判断')) {
        const first = String(answer).replace(/\r|\n/g, '').charAt(0);
        const idx = list.findIndex((el) => (el.innerText || '').includes(first));
        const target = idx >= 0 ? list[idx] : list[0];
        if (!target) return false;
        const icon = target.querySelector('.num_option');
        if (icon && icon.classList.contains('check_answer')) return true;
        skjHumanClick(icon || target);
        return true;
      }

      if (questionType.includes('连线')) {
        return this.fillCxLineAnswer(qEl, answer);
      }

      if (
        questionType.includes('填空') ||
        questionType.includes('分录') ||
        questionType.includes('资料')
      ) {
        const blanks = Array.from(qEl.querySelectorAll('.Answer'));
        if (!blanks.length) return false;
        let parts = String(answer).replace(/^#+|#+$/g, '').split('#');
        if (blanks.length === 1 && parts.length > 1) parts = [parts.join(';')];
        blanks.forEach((blank, i) => {
          const value = (parts[i] || parts[0] || '').trim();
          const textarea = blank.querySelector('textarea');
          if (textarea) {
            textarea.value = value;
            skjFireInput(textarea);
          }
          try {
            const body = blank.querySelector('iframe')?.contentDocument?.body?.querySelector('p');
            if (body) body.innerHTML = skjEscapeHtml(value);
          } catch (e) {}
        });
        return true;
      }

      // 简答 / 名词解释 / 论述 / 计算 / 其他
      const block = qEl.querySelector('.stem_answer') || qEl.querySelector('.Answer');
      const value = String(answer).replace(/^#+|#+$/g, '').replace(/#+/g, ',');
      let filled = false;
      if (block) {
        const textarea = block.querySelector('textarea');
        if (textarea) {
          textarea.value = value;
          skjFireInput(textarea);
          filled = true;
        }
        try {
          const body = block.querySelector('iframe')?.contentDocument?.body?.querySelector('p');
          if (body) {
            body.innerHTML = skjEscapeHtml(value);
            filled = true;
          }
        } catch (e) {}
      }
      return filled;
    }

    /** 作业/考试页 暂存 + 提交（含弹窗校验） */
    async saveQuestionLiPage(config, failedCount = 0, allowDisabled = false) {
      try {
        const tempSave = document.querySelector('#submitFocus a, .btnSave');
        if (tempSave && (tempSave.innerText || '').includes('暂')) {
          skjHumanClick(tempSave);
          AppState.log('已点击【暂时保存】');
        }
        if ((!allowDisabled && !getConfig().examEnabled) || !getConfig().autoSubmit) return;
        if (failedCount > 0) {
          AppState.log('存在未完成题目，已暂存答案，请手动核对后提交', 'warn');
          return;
        }
        const completeBtn = document.querySelector('a.completeBtn, .btnSubmit');
        if (!completeBtn) return;
        skjHumanClick(completeBtn);
        const popup = await skjWaitFor(() => this.findVisiblePopup(), { timeout: 8000, interval: 250 });
        if (!popup) {
          AppState.log('未检测到提交确认弹窗（可能已直接提交）', 'warn');
          return;
        }
        const content = this.readPopupContent();
        if (content.includes('未做完')) {
          this.clickPopupButton([], '#popno, .popno');
          AppState.log('平台提示仍有未作答题目，已取消提交（答案已暂存）', 'warn');
          return;
        }
        if (content.includes('未达到及格线')) {
          this.clickPopupButton([], '#popno, .popno');
          AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
          return;
        }
        this.clickPopupButton([], '#popok, .popBottom .confirm, .popok');
        AppState.log('已自动确认提交作业/考试');
      } catch (e) {
        AppState.log('提交作业/考试异常: ' + e.message, 'error');
      }
    }

    /* =====================================================================
     * 智慧树 作业 / 考试
     * =================================================================== */

    async solveZhihuishuExamPage(config, allowDisabled = false) {
      const container = document.querySelector('.examPaper_box, .questionContent, .exam-test, .ET-content');
      if (!container) return false;

      AppState.log('检测到智慧树作业/考试页面，开始 AI 作答...');
      let items = Array.from(container.querySelectorAll('.subject_node'));
      if (items.length <= 1) items = Array.from(container.querySelectorAll('.questionContent, .questionItem, .ET-item'));
      if (!items.length) items = [container];

      let ok = 0;
      let failed = 0;
      for (let i = 0; i < items.length; i++) {
        if (!allowDisabled && !getConfig().examEnabled) {
          AppState.log('AI 解题助手已关闭，已停止继续处理智慧树题目', 'warn');
          return true;
        }
        const item = items[i];
        AppState.setStatus(`正在解答智慧树题目 ${i + 1}/${items.length}...`);
        try {
          const stem = (
            item.querySelector('.subject_type_describe, .questionTit, .subject-title, .questionTit')?.innerText ||
            item.innerText ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 800);
          const typeRaw = item.querySelector('.subject_type span, .questionType, .subject-type')?.innerText || '';
          const questionType = /多选/.test(typeRaw)
            ? '多选题'
            : /判断/.test(typeRaw)
              ? '判断题'
              : /填空/.test(typeRaw)
                ? '填空题'
                : /简答|论述|名词/.test(typeRaw)
                  ? '简答题'
                  : '单选题';
          const optEls = Array.from(item.querySelectorAll('.nodeLab, .optionItem, .el-radio, .el-checkbox, .answerBg'));
          const options = optEls.map((el) => el.innerText.trim());
          const raw = await requestOpenAI(buildQuestionPrompt(questionType, stem, options), null, config);
          const answer = parseAnswerFromLLM(questionType, raw);
          AppState.log(`[智慧树 ${i + 1}/${items.length}] ${questionType} → ${answer}`);
          const filled = this.fillZhsQuestion(item, questionType, answer, optEls);
          if (filled) ok += 1;
          else failed += 1;
        } catch (err) {
          failed += 1;
          AppState.log(`[智慧树 ${i + 1}/${items.length}] 作答失败: ${err.message}`, 'error');
        }
        await skjSleep(Math.max(800, Number(config.solveInterval) || 1500));
      }

      AppState.log(`智慧树作答完成：成功 ${ok} 题${failed ? `，失败 ${failed} 题` : ''}`);
      if (!allowDisabled && !getConfig().examEnabled) return true;
      const nextBtn = document.querySelector('.pre-next .next-t, .btn-next, .nextBtn');
      if (nextBtn && skjIsDisplayed(nextBtn)) {
        skjHumanClick(nextBtn);
        AppState.log('已自动点击下一题');
      }
      return true;
    }

    fillZhsQuestion(item, questionType, answer, optEls) {
      const list = optEls && optEls.length ? optEls : [];
      if (questionType === '多选题') {
        let hit = false;
        list.forEach((el) => {
          const letter = skjLeadingLetter(el.innerText);
          const input = el.querySelector('input');
          const checked =
            !!(input && input.checked) || el.classList.contains('active') || el.classList.contains('is-checked');
          const should = !!letter && String(answer).includes(letter);
          if (should) hit = true;
          if (should !== checked) skjHumanClick(input || el);
        });
        return hit;
      }
      if (questionType === '填空题' || questionType === '简答题') {
        const inputs = Array.from(item.querySelectorAll('textarea, input[type="text"]'));
        if (!inputs.length) return false;
        const parts = String(answer).split('#');
        inputs.forEach((input, i) => {
          input.value = (parts[i] || parts[0] || '').trim();
          skjFireInput(input);
        });
        return true;
      }
      const target =
        list.find((el) => skjOptionMatches(el.innerText, answer)) ||
        list.find((el) => el.innerText.includes(String(answer).charAt(0))) ||
        list[0];
      if (!target) return false;
      skjHumanClick(target.querySelector('input') || target);
      return true;
    }
  }

  /* =========================================================================
   * 控制面板样式表
   * ========================================================================= */
  const UI_STYLES = `
          /* 刷课酱主容器与字体 */
          #skj-widget, #skj-modal {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #1f2937;
            box-sizing: border-box;
            z-index: 2147483640;
          }
          #skj-widget *, #skj-modal * {
            box-sizing: border-box;
          }

          /* 悬浮小胶囊球 */
          #skj-widget {
            position: fixed;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
            color: #ffffff;
            border-radius: 9999px;
            box-shadow: 0 4px 14px rgba(29, 78, 216, 0.35);
            cursor: move;
            user-select: none;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          #skj-widget:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(29, 78, 216, 0.45);
          }
          #skj-widget-logo {
            font-weight: 700;
            font-size: 15px;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          #skj-widget-status {
            font-size: 12px;
            padding: 2px 8px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            max-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          #skj-widget-btn {
            cursor: pointer;
            background: none;
            border: none;
            color: #ffffff;
            font-size: 14px;
            display: flex;
            align-items: center;
            padding: 2px;
          }

          /* 模态弹窗遮罩 */
          #skj-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(2px);
            align-items: center;
            justify-content: center;
          }
          #skj-modal.show {
            display: flex;
          }

          /* 模态弹窗主体 */
          .skj-dialog {
            width: 580px;
            max-width: 92vw;
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            max-height: 85vh;
            animation: skjFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes skjFadeIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }

          /* 弹窗头部 */
          .skj-header {
            padding: 16px 20px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .skj-header-title {
            font-size: 16px;
            font-weight: 700;
            color: #0f172a;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .skj-badge {
            font-size: 11px;
            font-weight: 600;
            color: #2563eb;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            padding: 2px 6px;
            border-radius: 6px;
          }
          .skj-close {
            background: none;
            border: none;
            font-size: 20px;
            color: #64748b;
            cursor: pointer;
            border-radius: 6px;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .skj-close:hover {
            background: #e2e8f0;
            color: #0f172a;
          }

          /* 标签导航栏 */
          .skj-tabs {
            display: flex;
            border-bottom: 1px solid #e2e8f0;
            background: #ffffff;
          }
          .skj-tab {
            flex: 1;
            padding: 12px;
            text-align: center;
            font-weight: 600;
            color: #64748b;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
          }
          .skj-tab.active {
            color: #2563eb;
            border-bottom-color: #2563eb;
            background: #f8fafc;
          }

          /* 内容区 */
          .skj-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
          }
          .skj-panel {
            display: none;
          }
          .skj-panel.active {
            display: block;
          }

          /* 弹窗底部操作栏 */
          .skj-footer {
            padding: 12px 20px;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
          }
          .skj-footer-status {
            font-size: 12px;
            color: #10b981;
            display: flex;
            align-items: center;
            gap: 4px;
          }

          /* 表单控件 */
          .skj-form-item {
            margin-bottom: 16px;
          }
          .skj-form-label {
            display: flex;
            justify-content: space-between;
            font-weight: 600;
            font-size: 13px;
            color: #334155;
            margin-bottom: 6px;
          }
          .skj-form-desc {
            font-size: 12px;
            color: #64748b;
            margin-top: 4px;
          }
          .skj-input {
            width: 100%;
            padding: 9px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
          }
          .skj-input:focus {
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
          }

          /* 开关切换 Switch */
          .skj-switch-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #f1f5f9;
          }
          .skj-switch-text {
            font-weight: 600;
            color: #1e293b;
          }
          .skj-switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
          }
          .skj-switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .skj-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #cbd5e1;
            transition: 0.3s;
            border-radius: 24px;
          }
          .skj-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: 0.3s;
            border-radius: 50%;
          }
          .skj-switch input:checked + .skj-slider {
            background-color: #2563eb;
          }
          .skj-switch input:checked + .skj-slider:before {
            transform: translateX(20px);
          }

          /* 状态卡片与控制台日志 */
          .skj-status-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .skj-status-dot {
            display: inline-block;
            width: 10px;
            height: 10px;
            background: #10b981;
            border-radius: 50%;
            margin-right: 6px;
          }
          .skj-actions {
            display: flex;
            gap: 10px;
            margin-bottom: 16px;
          }
          .skj-btn {
            flex: 1;
            padding: 10px 14px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
          }
          .skj-btn-primary {
            background: #2563eb;
            color: #ffffff;
          }
          .skj-btn-primary:hover {
            background: #1d4ed8;
          }
          .skj-btn-secondary {
            background: #e2e8f0;
            color: #334155;
          }
          .skj-btn-secondary:hover {
            background: #cbd5e1;
          }
          .skj-btn-danger {
            background: #ef4444;
            color: #ffffff;
          }

          /* 日志窗口 */
          .skj-console {
            height: 170px;
            background: #0f172a;
            color: #e2e8f0;
            border-radius: 10px;
            padding: 10px;
            font-family: Consolas, Monaco, monospace;
            font-size: 12px;
            overflow-y: auto;
            line-height: 1.6;
          }
          .skj-log-item {
            word-break: break-all;
          }
          .skj-log-item.error { color: #f87171; }
          .skj-log-item.warn { color: #facc15; }

          /* 警告小注 */
          .skj-alert {
            background: #fffbeb;
            border: 1px solid #fef3c7;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 12px;
            color: #b45309;
            margin-top: 10px;
            display: flex;
            gap: 6px;
          }
  `;

  /* =========================================================================
   * 7. 现代化悬浮设置面板与 UI 渲染 (仅在顶层窗口创建)
   * ========================================================================= */
  class UIController {
    constructor(videoAssist, examAssist) {
      this.videoAssist = videoAssist;
      this.examAssist = examAssist;
      this.panelOpen = false;
      this.activeTab = 'dashboard';
    }

    init() {
      // 仅在顶层页面加载 UI，避免在嵌套的数百个 iframe 中重复渲染悬浮窗
      if (window.self !== window.top) return;

      this.createStyles();
      this.createFloatingWidget();
      this.createSettingsModal();
      this.bindEvents();

      // 订阅状态更新
      AppState.subscribe((state) => {
        this.updateBadge(state);
        this.updateLogs(state);
      });

      // 注册油猴菜单
      if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('⚙️ 打开刷课酱设置', () => this.toggleModal(true));
        GM_registerMenuCommand('📝 立即解答当前页面题目', () => this.examAssist.solveCurrentPage(true));
      }
    }
    createStyles() {
      const style = document.createElement("style");
      style.id = "skj-styles";
      style.textContent = UI_STYLES;
      document.head.appendChild(style);
    }


    createFloatingWidget() {
      const cfg = getConfig();
      const pos = cfg.panelPosition || { top: 80, right: 20 };

      const widget = document.createElement('div');
      widget.id = 'skj-widget';
      widget.style.top = pos.top + 'px';
      widget.style.right = pos.right + 'px';

      widget.innerHTML = `
        <div id="skj-widget-logo">🤖 刷课酱</div>
        <div id="skj-widget-status">就绪</div>
        <button id="skj-widget-btn" title="点击打开设置面板">⚙️</button>
      `;

      document.body.appendChild(widget);

      // 实现平滑拖拽
      let isDragging = false;
      let startX, startY, initialTop, initialRight;

      widget.addEventListener('mousedown', (e) => {
        if (e.target.id === 'skj-widget-btn') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialTop = widget.offsetTop;
        initialRight = window.innerWidth - (widget.offsetLeft + widget.offsetWidth);
        widget.style.transition = 'none';
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newTop = Math.max(10, Math.min(window.innerHeight - 50, initialTop + dy));
        const newRight = Math.max(10, Math.min(window.innerWidth - 120, initialRight - dx));
        widget.style.top = newTop + 'px';
        widget.style.right = newRight + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        widget.style.transition = '';
        Storage.set('panelPosition', {
          top: parseInt(widget.style.top, 10),
          right: parseInt(widget.style.right, 10)
        });
      });
    }

    createSettingsModal() {
      const modal = document.createElement('div');
      modal.id = 'skj-modal';

      const cfg = getConfig();

      modal.innerHTML = `
        <div class="skj-dialog">
          <div class="skj-header">
            <div class="skj-header-title">
              <span>🤖 刷课酱控制台</span>
              <span class="skj-badge">v2.1.0</span>
            </div>
            <button class="skj-close" id="skj-close-btn">&times;</button>
          </div>

          <div class="skj-tabs">
            <div class="skj-tab active" data-tab="dashboard">📊 控制仪表盘</div>
            <div class="skj-tab" data-tab="video">🎬 视频设置</div>
            <div class="skj-tab" data-tab="ai">🧠 AI 接口配置</div>
          </div>

          <div class="skj-body">
            <!-- 标签页 1: 仪表盘 -->
            <div class="skj-panel active" id="skj-panel-dashboard">
              <div class="skj-status-card">
                <div>
                  <div style="font-weight: 700; color: #1e293b; margin-bottom: 2px;">
                    <span class="skj-status-dot"></span>当前状态
                  </div>
                  <div id="skj-modal-status-text" style="color: #64748b; font-size: 13px;">就绪</div>
                </div>
                <div>
                  <button class="skj-btn skj-btn-secondary" id="skj-quick-clear-btn" style="padding: 6px 10px;">清空日志</button>
                </div>
              </div>

              <div class="skj-actions">
                <button class="skj-btn skj-btn-primary" id="skj-manual-solve-btn">📝 立即解答当前题目</button>
                <button class="skj-btn skj-btn-secondary" id="skj-next-btn">⏭️ 强制跳转下一节</button>
              </div>

              <div class="skj-form-label">运行日志</div>
              <div class="skj-console" id="skj-console-box"></div>
            </div>

            <!-- 标签页 2: 视频设置 -->
            <div class="skj-panel" id="skj-panel-video">
              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">开启视频助手</div>
                  <div class="skj-form-desc">开启后自动接管网页视频并执行设定的播放逻辑</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-videoEnabled" ${cfg.videoEnabled ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">自动连续播放 (自动下一节)</div>
                  <div class="skj-form-desc">视频播放完毕后自动寻找并点击下一节课程</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-autoNext" ${cfg.autoNext ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">自动跳过已完成任务点</div>
                  <div class="skj-form-desc">播放视频前检查是否已有完成绿标，已完成则自动秒跳下一节</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-skipFinished" ${cfg.skipFinished ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">自动静音播放</div>
                  <div class="skj-form-desc">规避浏览器自动播放限制，防止爆音干扰</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-muted" ${cfg.muted ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">自动跳过/求解视频随堂测验 (弹题)</div>
                  <div class="skj-form-desc">视频中间停顿弹题时自动答题或解除暂停</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-autoSolveVideoQuiz" ${cfg.autoSolveVideoQuiz ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-form-item" style="margin-top: 16px;">
                <div class="skj-form-label">视频播放倍速</div>
                <select class="skj-input" id="skj-cfg-playbackRate">
                  <option value="1.0" ${cfg.playbackRate == 1.0 ? 'selected' : ''}>1.0x (原速 / 推荐)</option>
                  <option value="1.25" ${cfg.playbackRate == 1.25 ? 'selected' : ''}>1.25x (平稳快速)</option>
                  <option value="1.5" ${cfg.playbackRate == 1.5 ? 'selected' : ''}>1.5x (快速)</option>
                  <option value="2.0" ${cfg.playbackRate == 2.0 ? 'selected' : ''}>2.0x (极速)</option>
                  <option value="2.5" ${cfg.playbackRate == 2.5 ? 'selected' : ''}>2.5x (超速)</option>
                </select>
                <div class="skj-form-desc">注：内置底层反检测 HOOK，可防止倍速被网页强制重置</div>
              </div>
            </div>

            <!-- 标签页 3: AI 接口配置 -->
            <div class="skj-panel" id="skj-panel-ai">
              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">开启 AI 解题助手</div>
                  <div class="skj-form-desc">遇到章节测验或作业/考试时自动识别题干并请求 AI 答案</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-examEnabled" ${cfg.examEnabled ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-switch-item">
                <div>
                  <div class="skj-switch-text">做完后自动提交</div>
                  <div class="skj-form-desc">开启后自动填入、暂存并自动点击提交按钮完成测验</div>
                </div>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-autoSubmit" ${cfg.autoSubmit ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>

              <div class="skj-alert">
                <span>💡</span>
                <span>已默认开启【自动提交】，答题完毕后将自动确认提交。如需人工检查核对，可在此处关闭此开关。</span>
              </div>

              <div style="margin-top: 18px; margin-bottom: 8px; font-size: 13px; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 6px;">
                <span>🔑</span>
                <span>大模型 API 接口参数设置 (需手动保存)</span>
              </div>

              <div class="skj-form-item">
                <div class="skj-form-label">API 接口地址 (Base URL)</div>
                <input type="text" class="skj-input" id="skj-cfg-openaiBaseUrl" placeholder="https://api.openai.com/v1" value="${cfg.openaiBaseUrl}">
                <div class="skj-form-desc">支持任意 OpenAI 兼容地址，例如 DeepSeek、OneAPI、SiliconFlow 或本地 Ollama</div>
              </div>

              <div class="skj-form-item">
                <div class="skj-form-label">API Key (密钥)</div>
                <input type="password" class="skj-input" id="skj-cfg-openaiApiKey" placeholder="sk-..." value="${cfg.openaiApiKey}">
                <div class="skj-form-desc">密钥仅保存在您本地油猴脚本存储中，跨网站全局共享，绝不上传至任何第三方服务器</div>
              </div>

              <div class="skj-form-item">
                <div class="skj-form-label">模型名称 (Model)</div>
                <input type="text" class="skj-input" id="skj-cfg-openaiModel" placeholder="gpt-4o-mini" value="${cfg.openaiModel}">
                <div class="skj-form-desc">例如：gpt-4o-mini、deepseek-chat、qwen-turbo、claude-3-haiku 等</div>
              </div>

              <div style="display: flex; gap: 10px; margin-top: 16px;">
                <button class="skj-btn skj-btn-secondary" id="skj-test-ai-btn">⚡ 测试 API 连接</button>
                <button class="skj-btn skj-btn-primary" id="skj-save-api-btn">💾 保存 API 配置</button>
              </div>
            </div>
          </div>

        </div>
      `;

      document.body.appendChild(modal);
    }

    bindEvents() {
      const widgetBtn = document.getElementById('skj-widget-btn');
      const modal = document.getElementById('skj-modal');
      const closeBtn = document.getElementById('skj-close-btn');

      widgetBtn.addEventListener('click', () => this.toggleModal(true));
      closeBtn.addEventListener('click', () => this.toggleModal(false));

      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.toggleModal(false);
      });

      // 标签页切换
      const tabs = document.querySelectorAll('.skj-tab');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach((t) => t.classList.remove('active'));
          document.querySelectorAll('.skj-panel').forEach((p) => p.classList.remove('active'));

          tab.classList.add('active');
          const panelId = 'skj-panel-' + tab.dataset.tab;
          document.getElementById(panelId)?.classList.add('active');
        });
      });

      // 手动保存 API 配置按钮
      document.getElementById('skj-save-api-btn')?.addEventListener('click', () => {
        this.saveApiSettings(false);
      });

      // 弹窗关闭按钮
      document.getElementById('skj-modal-close-bottom-btn')?.addEventListener('click', () => {
        this.toggleModal(false);
      });

      // 监听大部分开关与选择框变动，实时全自动保存
      const autoSaveSelectAndSwitches = [
        'skj-cfg-videoEnabled',
        'skj-cfg-autoNext',
        'skj-cfg-skipFinished',
        'skj-cfg-muted',
        'skj-cfg-autoSolveVideoQuiz',
        'skj-cfg-playbackRate',
        'skj-cfg-examEnabled',
        'skj-cfg-autoSubmit'
      ];

      autoSaveSelectAndSwitches.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            this.saveGeneralSettings();
          });
        }
      });

      // 测试 API
      document.getElementById('skj-test-ai-btn')?.addEventListener('click', async () => {
        this.saveApiSettings(true);
        const cfg = getConfig();
        AppState.log('正在测试 OpenAI API 连接...');
        try {
          const testRes = await requestOpenAI('请回答数字：1+1等于几？', null, cfg);
          AppState.log(`API 测试成功！模型回复: ${testRes.trim()}`);
          alert(`✅ API 连接成功！\n模型返回: ${testRes.trim()}`);
        } catch (e) {
          AppState.log(`API 测试失败: ${e.message}`, 'error');
          alert(`❌ API 连接失败:\n${e.message}`);
        }
      });

      // 一键解题
      document.getElementById('skj-manual-solve-btn')?.addEventListener('click', () => {
        this.examAssist.solveCurrentPage(true);
      });

      // 强制下一节
      document.getElementById('skj-next-btn')?.addEventListener('click', () => {
        this.videoAssist.triggerNextChapter();
      });

      // 清空日志
      document.getElementById('skj-quick-clear-btn')?.addEventListener('click', () => {
        AppState.logs = [];
        this.updateLogs(AppState);
      });
    }

    /**
     * 保存常规开关与选择设置（实时自动保存）
     */
    saveGeneralSettings() {
      const rateEl = document.getElementById('skj-cfg-playbackRate');
      const newCfg = {
        videoEnabled: document.getElementById('skj-cfg-videoEnabled')?.checked ?? true,
        autoNext: document.getElementById('skj-cfg-autoNext')?.checked ?? true,
        skipFinished: document.getElementById('skj-cfg-skipFinished')?.checked ?? true,
        muted: document.getElementById('skj-cfg-muted')?.checked ?? true,
        autoSolveVideoQuiz: document.getElementById('skj-cfg-autoSolveVideoQuiz')?.checked ?? true,
        playbackRate: parseFloat(rateEl?.value || '1.0'),

        examEnabled: document.getElementById('skj-cfg-examEnabled')?.checked ?? true,
        autoSubmit: document.getElementById('skj-cfg-autoSubmit')?.checked ?? true
      };
      setConfig(newCfg);

      // 立即向当前页面所有视频同步新设定的倍速和静音状态
      const videos = this.videoAssist.findMediaElements();
      for (const v of videos) {
        if (newCfg.muted && !v.muted) v.muted = true;
        this.videoAssist.applyPlaybackRate(v, newCfg.playbackRate);
      }

      this.showSaveTip('✅ 设置已实时自动保存并生效');
    }

    /**
     * 保存大模型 API 接口配置（用户手动点击保存）
     */
    saveApiSettings(silent = false) {
      const inputBaseUrl = document.getElementById('skj-cfg-openaiBaseUrl')?.value.trim() || 'https://api.openai.com/v1';
      const inputApiKey = document.getElementById('skj-cfg-openaiApiKey')?.value.trim() || '';
      const inputModel = document.getElementById('skj-cfg-openaiModel')?.value.trim() || 'gpt-4o-mini';

      Storage.set('openaiBaseUrl', inputBaseUrl);
      Storage.set('openaiApiKey', inputApiKey);
      Storage.set('openaiModel', inputModel);

      this.showSaveTip('✅ API 配置已成功保存！');
      if (!silent) {
        AppState.log(`API 配置已保存！模型: ${inputModel}`);
        alert('✅ API 接口配置已成功保存并全局生效！');
      }
    }

    showSaveTip(msg) {
      const tip = document.getElementById('skj-save-tip');
      if (tip) {
        tip.innerHTML = `<span style="color:#10b981;font-weight:600;">${msg}</span>`;
        if (this._tipTimer) clearTimeout(this._tipTimer);
        this._tipTimer = setTimeout(() => {
          tip.innerHTML = '<span>⚡ 大部分设置修改后实时自动生效并保存</span>';
        }, 2500);
      }
    }

    toggleModal(show) {
      const modal = document.getElementById('skj-modal');
      if (show) {
        modal.classList.add('show');
      } else {
        modal.classList.remove('show');
      }
    }

    updateBadge(state) {
      const badge = document.getElementById('skj-widget-status');
      const modalStatus = document.getElementById('skj-modal-status-text');
      if (badge) badge.innerText = state.status;
      if (modalStatus) modalStatus.innerText = state.status;
    }

    updateLogs(state) {
      const box = document.getElementById('skj-console-box');
      if (!box) return;
      box.innerHTML = state.logs
        .map((l) => `<div class="skj-log-item ${l.level}">[${l.time}] ${l.msg}</div>`)
        .join('');
      box.scrollTop = box.scrollHeight;
    }
  }

  /* =========================================================================
   * 8. 主程序引导与初始化
   *    说明：用户脚本在每一层框架中都会执行，这里采用“顶层编排 + 子框架协助”的模式：
   *    - 顶层框架：创建控制面板，并编排整条学习流水线（超星任务点队列 / 智慧树小节推进）
   *    - 同源子框架：由顶层通过 contentDocument 递归访问，无需自行跳转
   *    - 跨域子框架：只负责本框架内的媒体接管，播放完成后向顶层广播事件
   * ========================================================================= */
  function main() {
    const videoAssist = new VideoAssistant();
    const examAssist = new ExamAssistant(videoAssist);
    videoAssist.setExamAssistant(examAssist);

    const isTop = skjIsTopFrame();

    // 1. 初始化浮窗界面（仅顶层框架）
    if (isTop) {
      const ui = new UIController(videoAssist, examAssist);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.init());
      } else {
        ui.init();
      }
    }

    // 2. 启动学习流水线（每帧都启动，由内部自行判定职责）
    videoAssist.start();

    // 3. 页面加载完成后按站点自动进入答题流程（仅顶层，避免多个实例重复触发）
    if (isTop) {
      window.addEventListener('load', () => {
        const cfg = getConfig();

        // 3.1 独立作业 / 考试页面：延时自动作答
        if (cfg.examEnabled && (Site.isCxWorkOrExam || Site.isZhsExam)) {
          setTimeout(() => {
            examAssist.solveCurrentPage(false);
          }, 3000);
          return;
        }

        // 3.2 超星学习任务页：重新识别任务点（含首屏即为测验的情况）
        if (Site.isCxStudentStudy) {
          setTimeout(() => {
            videoAssist.kick();
          }, 2500);
        }
      });
    }

    console.log('[刷课酱] 网课视频助手与 AI 解题助手启动就绪！');
  }

  main();
})();
