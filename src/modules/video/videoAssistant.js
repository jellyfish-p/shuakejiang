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
    this._zhsQuizTimer = null;
    this._zhsQuizBusy = false;
    this._zhsCompleted = false;
  }

  setExamAssistant(examAssist) {
    this.examAssist = examAssist;
  }

  start() {
    if (this.active) return;
    this.active = true;
    if (skjIsTopFrame()) this.bindCrossFrameMessages();
    // 弹题可能挂在智慧树的视频子框架中，不能只让顶层页面轮询。
    if (Site.isZhihuishu) this.startZhsQuizPolling();
    this.loop();
  }

  stop() {
    this.active = false;
    this._lifecycle += 1;
    this.cxRunner.cancelCurrent();
    if (this.timer) clearTimeout(this.timer);
    if (this._zhsQuizTimer) clearTimeout(this._zhsQuizTimer);
    this.timer = null;
    this._zhsQuizTimer = null;
    this._zhsQuizBusy = false;
  }

  /** 页面切换或手动触发：强制重新识别任务点 */
  optionsChanged() {
    this._lifecycle += 1;
    if (this.cxRunner.running) this.cxRunner.cancelCurrent();
  }

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
    if (config.videoEnabled) {
      this.zhsApplyControlBarRate(config.playbackRate);
      this.processMedia(document, config, { autoJump: false });
    }
    this.handlePauseArtifacts(document);

    // 弹题是异步渲染的，可能在视频结束前后任意时刻出现。只要弹窗还在，
    // 就不能先切换小节；独立轮询器会负责发现并处理它。
    if (this.zhsPopupDialog()) return;
    if (!config.videoEnabled || !config.autoNext) return;
    if (this._zhsCompleted) return;
    if (Date.now() < this._jumpLock) return;

    const sections = this.zhsSections();
    if (!sections.length) return;
    const active = this.zhsActiveSection(sections);
    if (!active) return;

    const media = this.zhsCurrentVideo();
    const ended = media ? CxDom.isMediaFinished(media) || this.zhsControlBarEnded() : this.zhsControlBarEnded();
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
    if (Site.isZhihuishu) this.zhsApplyControlBarRate(config.playbackRate);
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
    return false;
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
    if (!Site.isZhihuishu) this.applyPlaybackRate(media, config.playbackRate);

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
    const stopped = () => {
      const live = getConfig();
      const keys = ['cxFontStrategy', 'cxVisionUseMain', 'cxVisionBaseUrl', 'cxVisionApiKey', 'cxVisionModel',
        'openaiBaseUrl', 'openaiApiKey', 'openaiModel'];
      return taskIframe.isConnected === false || taskIframe.contentDocument !== doc || box.isConnected === false ||
        !live.videoEnabled || !live.autoSolveVideoQuiz ||
        keys.some(key => (live[key] ?? DEFAULT_CONFIG[key]) !== (config[key] ?? DEFAULT_CONFIG[key]));
    };
    try {
      const titleEl = doc.querySelector('.tkTopic_title');
      const reader = await CxFont.prepare([box, titleEl].filter(Boolean), config, { cancelled: stopped });
      const typeTitle = reader.readText(titleEl);
      const questionType = /多选/.test(typeTitle)
        ? '多选题'
        : /判断/.test(typeTitle)
          ? '判断题'
          : '单选题';
      const stem = reader.readText(doc.querySelector('.ans-videoquiz .tkTopic') || box)
        .replace(/\s+/g, ' ')
        .trim();
      const optEls = Array.from(doc.querySelectorAll('.ans-videoquiz-opt'));
      const options = optEls.map((el) => reader.readText(el).trim());
      if (!optEls.length) return 'none';

      const note = attempt > 0 ? '上一次提交的答案被平台判定为错误，请重新仔细分析题目。' : '';
      const answers = await requestQuestionBatch([{ id: 'q1', type: questionType, title: stem, options }], config, note);
      if (stopped()) return 'none';
      reader.assertCurrent();
      const answer = answers.get('q1');
      if (!answer || !skjFillChoice(optEls, questionType, answer, options)) {
        AppState.log('视频弹题答案无效或选中状态校验失败，未提交', 'warn');
        return 'failed';
      }
      AppState.log(`视频随堂弹题（${questionType}）AI 答案：${answer}`);

      await skjSleep(800);
      if (stopped()) return 'none';
      reader.assertCurrent();
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
      // 新版智慧树目录由 .course-catalog/.chapter-item 组成，章节折叠不影响
      // DOM 中的小节顺序，因此这里直接按目录顺序收集所有小节。
      const catalog = document.querySelector('.course-catalog');
      const modern = Array.from((catalog || document).querySelectorAll('.chapter-item'));
      if (modern.length) return modern;

      // 兼容旧版目录。
      const legacy = Array.from(document.querySelectorAll('li.video'));
      if (legacy.length) return legacy;
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
          el.classList.contains('active') ||
          el.classList.contains('current')
      ) || null
    );
  }

  zhsSectionKey(el) {
    if (!el) return '';
    return (
      el.getAttribute('data-id') ||
      el.getAttribute('data-video-id') ||
      el.getAttribute('data-file-id') ||
      el.getAttribute('data-lesson-id') ||
      el.id ||
      el.querySelector('.catalogue_title')?.innerText?.trim() ||
      [el.querySelector('.item-num')?.innerText, el.querySelector('.item-name')?.innerText]
        .filter(Boolean)
        .join(':') ||
      ''
    );
  }

  zhsIsSectionDone(el) {
    try {
      const progress = el.querySelector('[role="progressbar"][aria-valuenow], [aria-valuenow]');
      if (progress) {
        const value = Number(progress.getAttribute('aria-valuenow'));
        if (Number.isFinite(value)) return value >= 99.5;
      }
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
      return (
        document.querySelector('#vjs_container_html5_api, .videoArea video, video') ||
        this.findMediaElements(document).find((media) => media.tagName?.toLowerCase() === 'video') ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  /**
   * 新版智慧树不应直接改写 video.playbackRate：页面的 controlsBar 才是
   * 播放器状态源。点击对应的 .speedTab 会同时更新 UI 和实际播放器。
   */
  zhsApplyControlBarRate(targetRate) {
    const requested = Number(targetRate) || 1;
    try {
      const bars = skjCollectDocs(document)
        .flatMap((doc) => Array.from(doc.querySelectorAll('.controlsBar')))
        .filter(Boolean);
      for (const bar of bars) {
        const tabs = Array.from(bar.querySelectorAll('.speedBox .speedTab[rate], .speedTab[rate]'));
        if (!tabs.length) continue;

        const active = tabs.find((tab) => tab.classList.contains('active'));
        const exact = tabs.find((tab) => Math.abs(Number(tab.getAttribute('rate')) - requested) < 0.01);
        const chosen = exact || tabs.reduce((best, tab) => {
          const rate = Number(tab.getAttribute('rate'));
          if (!Number.isFinite(rate)) return best;
          if (!best) return tab;
          return Math.abs(rate - requested) < Math.abs(Number(best.getAttribute('rate')) - requested) ? tab : best;
        }, null);
        if (!chosen) continue;

        const actual = Number(chosen.getAttribute('rate'));
        if (active && Math.abs(Number(active.getAttribute('rate')) - actual) < 0.01) return true;
        if (!skjHumanClick(chosen)) continue;
        skjLogOnce(
          'zhs-rate-' + actual,
          Math.abs(actual - requested) < 0.01
            ? `智慧树已通过控制栏设置 ${actual}x 倍速`
            : `智慧树控制栏不支持 ${requested}x，已使用最接近的 ${actual}x 倍速`,
          Math.abs(actual - requested) < 0.01 ? 'info' : 'warn'
        );
        return true;
      }
    } catch (e) {}
    return false;
  }

  zhsControlBarEnded() {
    try {
      const bar = skjCollectDocs(document)
        .map((doc) => doc.querySelector('.controlsBar'))
        .find(Boolean);
      const current = bar?.querySelector('.currentTime')?.innerText || '';
      const duration = bar?.querySelector('.duration')?.innerText || '';
      const parse = (value) => {
        const parts = String(value).trim().split(':').map(Number);
        if (!parts.length || parts.some((part) => !Number.isFinite(part))) return NaN;
        return parts.reduce((total, part) => total * 60 + part, 0);
      };
      const now = parse(current);
      const total = parse(duration);
      return total > 0 && now >= total - 0.5;
    } catch (e) {
      return false;
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
    const nextTarget = next.classList.contains('chapter-item') ? next.querySelector('.item-box') || next : next;
    skjHumanClick(nextTarget);
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
          const retryTarget = again.classList.contains('chapter-item') ? again.querySelector('.item-box') || again : again;
          skjHumanClick(retryTarget);
        }
      }
    }, 3200);
  }

  /**
   * 智慧树弹题轮询。弹题通常在视频结束后出现，但页面可能延迟渲染、
   * 也可能在未触发 ended 事件时出现，所以不能只依赖视频结束回调。
   */
  startZhsQuizPolling() {
    if (this._zhsQuizTimer || !Site.isZhihuishu) return;
    const poll = () => {
      this._zhsQuizTimer = null;
      if (!this.active) return;
      const config = getConfig();
      if (config.autoSolveVideoQuiz) {
        try {
          const task = this.zhsSolvePopupQuiz(config);
          if (task && typeof task.catch === 'function') task.catch(() => {});
        } catch (e) {}
      }
      this._zhsQuizTimer = setTimeout(poll, 600);
    };
    poll();
  }

  zhsPopupDialog() {
    try {
      const dialogs = Array.from(
        document.querySelectorAll('#playTopic-dialog, .el-dialog.ai-class-exercise-dialog')
      );
      return dialogs.find((dialog) => skjIsDeepVisible(dialog)) || null;
    } catch (e) {
      return null;
    }
  }

  /** 智慧树视频弹题（旧版 Vue 弹题 + 新版 AI 随堂练习弹窗） */
  zhsSolvePopupQuiz(config) {
    const dialog = this.zhsPopupDialog();
    if (!dialog) return false;

    if (dialog.classList.contains('ai-class-exercise-dialog')) {
      if (this._zhsQuizBusy) return true;
      this._zhsQuizBusy = true;
      return this.zhsSolveAiExercise(dialog, config).finally(() => {
        this._zhsQuizBusy = false;
      });
    }

    if (this.zhsAnswerPopupQuizDirect(dialog)) return true;
    this.ensureZhsQuizBridge();
    return true;
  }

  zhsPopupQuestions(dialog) {
    try {
      return Array.from(dialog.querySelectorAll('.ques-list .item')).map((item, index) => {
        const typeText = item.querySelector('.type')?.innerText || '';
        const questionType = /多选/.test(typeText)
          ? '多选题'
          : /判断/.test(typeText)
            ? '判断题'
            : /填空/.test(typeText)
              ? '填空题'
              : '单选题';
        const stem = (item.querySelector('.question-info')?.innerText || item.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();
        const optionEls = Array.from(item.querySelectorAll('.option'));
        const options = optionEls.map(
          (option) => (option.querySelector('.answer')?.innerText || option.innerText || '').replace(/\s+/g, ' ').trim()
        );
        return { id: `zhs-q${index + 1}`, item, questionType, stem, optionEls, options };
      }).filter((question) => question.stem && question.options.length);
    } catch (e) {
      return [];
    }
  }

  zhsPopupOptionSelected(option) {
    const nodes = [option, option?.querySelector('.class-question-select')].filter(Boolean);
    return nodes.some((node) => {
      const className = String(node.className || '');
      return node.getAttribute?.('aria-checked') === 'true' ||
        /(?:^|[ _-])(active|selected|checked|is-checked|is-active|check_answer)(?:$|[ _-])/.test(className);
    });
  }

  zhsFillPopupQuestion(question, answer) {
    const { item, questionType, optionEls } = question;
    if (questionType.includes('填空')) {
      const inputs = Array.from(item.querySelectorAll('textarea, input[type="text"]'));
      if (!inputs.length) return false;
      const values = Array.isArray(answer) ? answer : String(answer).split('#');
      inputs.forEach((input, index) => {
        input.value = String(values[index] ?? values[0] ?? '').trim();
        skjFireInput(input);
      });
      return values.some((value) => String(value || '').trim());
    }

    const rawAnswer = Array.isArray(answer) ? answer.join('') : String(answer || '');
    let indices;
    if (questionType.includes('判断') && !/^[A-Za-z]+$/.test(rawAnswer)) {
      const value = skjJudgmentValue(rawAnswer);
      if (value === null) return false;
      indices = optionEls
        .map((option, index) => skjJudgmentValue(option.querySelector('.answer')?.innerText || option.innerText) === value ? index : -1)
        .filter((index) => index >= 0);
    } else {
      const letters = rawAnswer.toUpperCase().match(/[A-Z]/g) || [];
      indices = Array.from(new Set(letters)).map((letter) => letter.charCodeAt(0) - 65);
    }
    if (!indices.length || indices.some((index) => index < 0 || index >= optionEls.length)) return false;

    const expected = new Set(indices);
    const stateKnown = optionEls.some((option) => this.zhsPopupOptionSelected(option));
    for (let index = 0; index < optionEls.length; index++) {
      const option = optionEls[index];
      const selected = this.zhsPopupOptionSelected(option);
      const shouldSelect = expected.has(index);
      if (selected === shouldSelect) continue;
      const control = option.querySelector('.class-question-select') || option;
      if (!skjHumanClick(control)) return false;
    }

    // 新版 Vue 会在 click 后同步切换 active/checked 类；若页面没有暴露
    // 选中标记，则至少确保每个目标选项都成功触发了点击事件。
    if (!stateKnown) return true;
    return optionEls.every((option, index) => this.zhsPopupOptionSelected(option) === expected.has(index));
  }

  async zhsSolveAiExercise(dialog, config) {
    const questions = this.zhsPopupQuestions(dialog);
    if (!questions.length) return false;
    const key = questions
      .map((question) => `${question.questionType}:${question.stem}:${question.options.join('|')}`)
      .join('||');
    if (dialog.dataset.skjQuizKey === key) return true;
    if (!String(config.openaiApiKey || '').trim()) {
      skjLogOnce('zhs-ai-quiz-nokey', '检测到智慧树 AI 随堂练习，但未配置 API Key，请手动作答', 'warn');
      return false;
    }

    const lifecycle = this._lifecycle;
    const href = location.href;
    const stillCurrent = () =>
      this.active && lifecycle === this._lifecycle && location.href === href && dialog.isConnected !== false;
    try {
      const payload = questions.map(({ id, questionType, stem, options }) => ({
        id,
        type: questionType,
        title: stem,
        options
      }));
      const answers = await requestQuestionBatch(payload, config);
      if (!stillCurrent() || !getConfig().autoSolveVideoQuiz) return false;

      for (const question of questions) {
        const answer = answers.get(question.id);
        if (answer === undefined || !this.zhsFillPopupQuestion(question, answer)) {
          throw new Error(`题目 ${question.id} 答案无效或选中状态校验失败`);
        }
      }

      const submit = Array.from(dialog.querySelectorAll('button')).find((button) =>
        /提交作答/.test(button.innerText || button.textContent || '')
      ) || dialog.querySelector('button.el-button.btn');
      if (!submit || !skjHumanClick(submit)) throw new Error('未找到智慧树随堂练习提交按钮');
      dialog.dataset.skjQuizKey = key;
      AppState.log(`智慧树 AI 随堂练习已自动作答（${questions.length} 题）`);
      return true;
    } catch (e) {
      AppState.log('智慧树 AI 随堂练习作答失败: ' + (e && e.message ? e.message : e), 'error');
      return false;
    }
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
      const lifecycle = this._lifecycle;
      const href = location.href;
      const stillCurrent = () => this.active && lifecycle === this._lifecycle && location.href === href;
      matched.forEach((opt, i) => {
        setTimeout(() => {
          if (!stillCurrent()) return;
          try {
            vue.topicClickQot(opt);
          } catch (e) {}
        }, 500 * i);
      });
      setTimeout(
        () => {
          if (!stillCurrent()) return;
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
