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
