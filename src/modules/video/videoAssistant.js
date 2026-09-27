/* =========================================================================
 * 5. 视频助手核心实现 (自动播放、连播、倍速、防暂停、弹题)
 * ========================================================================= */
class VideoAssistant {
  constructor() {
    this.timer = null;
    this.lastVideo = null;
    this.active = false;
    this.examAssist = null;
    this._lastCompleteHandled = false;
    this._skipDebounce = false;
  }

  setExamAssistant(examAssist) {
    this.examAssist = examAssist;
  }

  start() {
    this.active = true;
    this.loop();
  }

  stop() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
  }

  loop() {
    if (!this.active) return;
    const config = getConfig();

    // 如果开启了“跳过已完成”与“自动下一节”，检查当前任务点是否已完成（适用于已完成的视频或小节）
    if (config.skipFinished && config.autoNext && !this._skipDebounce) {
      if (this.isTaskPointFinished()) {
        this._skipDebounce = true;
        AppState.log('检测到当前任务点已完成，自动跳过并进入下一节...');
        setTimeout(() => {
          this.triggerNextChapter();
          setTimeout(() => {
            this._skipDebounce = false;
          }, 3000);
        }, 1500);
        this.timer = setTimeout(() => this.loop(), 2000);
        return;
      }
    }

    if (config.videoEnabled) {
      this.processVideos(config);
    }

    // 如果当前没有正在播放的视频，且开启了解题助手，检查当前页面是否含有待解答的章节测验
    if (config.examEnabled && this.examAssist && !this.examAssist.isBusy) {
      this.checkAndSolveChapterQuiz(config);
    }

    this.timer = setTimeout(() => this.loop(), 1500);
  }

  /**
   * 检查当前任务点（视频、章节测验或小节）是否已经完成
   */
  isTaskPointFinished(video = null) {
    // 1. 超星/学习通
    if (Site.isChaoxing) {
      try {
        // (A) 如果传入了具体 video 元素，检查其挂载 iframe 与父级容器
        if (video) {
          const frameEl = video.ownerDocument?.defaultView?.frameElement;
          if (frameEl) {
            const parent = frameEl.parentElement;
            if (
              parent?.classList?.contains('ans-job-finished') ||
              frameEl.closest('.ans-job-finished') ||
              parent?.querySelector('.ans-job-icon.ans-job-finished')
            ) {
              return true;
            }
          }
          if (video.closest('.ans-job-finished')) {
            return true;
          }
        }

        // (B) 遍历顶层窗口与子 iframe 容器检查
        const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
        const topIframe = topDoc.querySelector('#iframe');
        if (topIframe?.contentDocument) {
          const finishedJobs = Array.from(topIframe.contentDocument.querySelectorAll('.ans-job-finished'));
          if (finishedJobs.length > 0) {
            if (video) {
              const fEl = video.ownerDocument?.defaultView?.frameElement;
              if (finishedJobs.some((f) => f.contains(fEl))) {
                return true;
              }
            } else {
              // 如果当前文档下有完成的任务标记且页面内任务均已完成
              const totalJobs = topIframe.contentDocument.querySelectorAll('.ans-attach-ct, .ans-job-icon');
              if (totalJobs.length > 0 && finishedJobs.length >= totalJobs.length) {
                return true;
              }
            }
          }
        }

        // (C) 检查当前激活的标签卡 (#prev_tab .active)
        const activeTab = topDoc.querySelector('#prev_tab .active, .prev_tab li.active');
        if (activeTab) {
          if (
            activeTab.classList.contains('ans-job-finished') ||
            activeTab.querySelector('.ans-job-finished, .icon-finish, .jobfinish, .prev_ul_icon_finish')
          ) {
            return true;
          }
        }
      } catch (e) {}
    }

    // 2. 智慧树
    if (Site.isZhihuishu) {
      try {
        const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
        const activeVideo = topDoc.querySelector('.inner-li li.clearfix.video.activeNode');
        if (activeVideo) {
          if (
            activeVideo.classList.contains('time_icofinish') ||
            activeVideo.querySelector('.time_icofinish, .finish-icon, .icon-finish')
          ) {
            return true;
          }
        }
        const activeRes = topDoc.querySelector('.resources-list .resources-item.active');
        if (activeRes) {
          if (activeRes.querySelector('.time_icofinish, .finish-icon, .icon-finish')) {
            return true;
          }
        }
      } catch (e) {}
    }

    // 3. 智慧职教 (ICVE)
    if (Site.isIcve) {
      try {
        const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
        const activeNode = topDoc.querySelector('.panelList .node.active');
        if (activeNode && (activeNode.classList.contains('is-finish') || activeNode.querySelector('.icon-finish, .finish'))) {
          return true;
        }
      } catch (e) {}
    }

    // 4. 中国大学 MOOC
    if (Site.isMooc) {
      try {
        const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
        const activeLesson = topDoc.querySelector('.j-item.active, .lesson-item.active');
        if (activeLesson && activeLesson.querySelector('.u-icon-finish, .j-icon-finish')) {
          return true;
        }
      } catch (e) {}
    }

    return false;
  }

  /**
   * 自动检测并解答超星章节测验
   */
  checkAndSolveChapterQuiz(config) {
    if (!Site.isChaoxing) return;

    // 如果当前页面有视频正在播放，优先等待视频播完
    const videos = this.findMediaElements();
    const hasPlayingVideo = videos.some((v) => !v.paused && !v.ended && v.currentTime > 0);
    if (hasPlayingVideo) return;

    try {
      const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
      const topIframe = topDoc.querySelector('#iframe');
      if (!topIframe) return;

      const doc1 = topIframe.contentDocument;
      const innerIframe = doc1?.querySelector('#frame_content');
      const targetDoc = innerIframe?.contentDocument || doc1;
      if (!targetDoc) return;

      // 检查是否已经答过或者无需作答 (已完成状态)
      const statusEl = targetDoc.querySelector('.testTit_status, .ceyan_status');
      const isComplete =
        statusEl?.classList?.contains('testTit_status_complete') ||
        targetDoc.body?.innerText?.includes('待批阅') ||
        targetDoc.querySelector('.Zy_sub')?.innerText?.includes('已完成');

      if (isComplete) {
        if (!this._lastCompleteHandled && config.autoNext) {
          this._lastCompleteHandled = true;
          AppState.log('检测到当前章节测验已完成，准备跳转下一节...');
          setTimeout(() => this.triggerNextChapter(), 2500);
        }
        return;
      }

      // 检查是否有题目且尚未在作答
      const questions = targetDoc.querySelectorAll('#ZyBottom .singleQuesId');
      if (questions.length > 0 && !targetDoc._skj_solving) {
        targetDoc._skj_solving = true;
        AppState.log(`自动检测到当前任务点为章节测验 (共 ${questions.length} 题)，启动 AI 求解...`);
        this.examAssist.solveCurrentPage(false).finally(() => {
          setTimeout(() => {
            targetDoc._skj_solving = false;
          }, 5000);
        });
      }
    } catch (e) {}
  }

  /**
   * 递归检索当前页面以及同源 iframe 中的所有视频与弹题
   */
  findMediaElements(root = document) {
    let videos = Array.from(root.querySelectorAll('video'));
    // 深度穿透检索同源 iframe
    const iframes = Array.from(root.querySelectorAll('iframe'));
    for (const ifr of iframes) {
      try {
        const win = ifr.contentWindow;
        if (win) {
          hookMediaWindow(win);
        }
        const doc = ifr.contentDocument || win?.document;
        if (doc) {
          videos = videos.concat(this.findMediaElements(doc));
        }
      } catch (e) {
        // 跨域 iframe 忽略
      }
    }
    return videos;
  }

  processVideos(config) {
    const videos = this.findMediaElements();

    for (const video of videos) {
      this.handleSingleVideo(video, config);
    }

    // 处理可能出现的暂停弹窗与人机验证掩码
    this.handlePauseArtifacts();

    // 处理视频随堂测验 (弹题)
    if (config.autoSolveVideoQuiz) {
      this.handleVideoQuizzes(config);
    }
  }

  handleSingleVideo(video, config) {
    if (!video) return;

    // 0. 优先检查当前视频任务点是否已完成，若已完成则直接跳过，不播放
    if (config.skipFinished && this.isTaskPointFinished(video)) {
      if (!video._skj_skip_handled) {
        video._skj_skip_handled = true;
        try {
          video.pause();
        } catch (e) {}
        AppState.log('检测到当前任务点视频已完成，自动跳过并进入下一节...');
        if (config.autoNext) {
          setTimeout(() => this.triggerNextChapter(), 1500);
        }
      }
      return;
    }

    // 1. 设置静音以规避现代浏览器的自动播放限制
    if (config.muted && !video.muted) {
      video.muted = true;
    }

    // 2. 强制设置播放倍速 (多层突破防倍速限制)
    const targetRate = Number(config.playbackRate) || 1.0;
    this.applyPlaybackRate(video, targetRate);

    // 3. 自动播放与防暂停
    if (config.autoPlay && video.paused && !video.ended) {
      video.play().catch((e) => {
        // 如果受限，确保静音再重试
        video.muted = true;
        video.play().catch(() => {});
      });
      AppState.isPlayingVideo = true;
      AppState.setStatus(`正在播放视频 (${targetRate}x)`);
    }

    // 4. 监听播放完毕事件 (绑定一次)
    if (!video._skj_bound) {
      video._skj_bound = true;
      video.addEventListener('ended', () => {
        AppState.log('当前视频播放完成！');
        if (config.autoNext) {
          AppState.log('准备自动跳转下一节...');
          setTimeout(() => this.triggerNextChapter(), 2000);
        }
      });
    }

    // 兜底时间监测：部分平台的视频 ended 事件被篡改或不触发
    if (video.duration > 0 && video.currentTime >= video.duration - 0.8 && !video._skj_ended_handled) {
      video._skj_ended_handled = true;
      AppState.log('检测到视频播放至末尾！');
      if (config.autoNext) {
        setTimeout(() => this.triggerNextChapter(), 2000);
      }
    }
  }

  /**
   * 安全并强制设置视频播放倍速 (突破超星/学习通防倍速限制)
   */
  applyPlaybackRate(video, targetRate) {
    if (!video) return;
    targetRate = Number(targetRate) || 1.0;

    // 确保该 video 所在的 window 原型链已被 Hook
    const ifrWin = video.ownerDocument?.defaultView || window;
    hookMediaWindow(ifrWin);

    // 捕获阶段拦截 ratechange 事件，阻断事件向后传播
    if (!video._skj_ratechange_captured) {
      video._skj_ratechange_captured = true;
      video.addEventListener(
        'ratechange',
        (e) => {
          e.stopImmediatePropagation();
        },
        true
      );
    }

    // 仅在真实倍速未同步时执行原生赋值
    if (Math.abs((video._skj_real_rate || 1.0) - targetRate) > 0.05) {
      const nativeDesc =
        ifrWin._skj_native_rate_desc ||
        Object.getOwnPropertyDescriptor(ifrWin.HTMLMediaElement.prototype, 'playbackRate');

      if (nativeDesc && nativeDesc.set) {
        video._skj_setting_real_rate = true;
        try {
          nativeDesc.set.call(video, targetRate);
          video._skj_real_rate = targetRate;
          AppState.log(`已将视频播放倍速设置为: ${targetRate}x`);
        } catch (e) {
          video.playbackRate = targetRate;
          video._skj_real_rate = targetRate;
        } finally {
          video._skj_setting_real_rate = false;
        }
      } else {
        video._skj_setting_real_rate = true;
        try {
          video.playbackRate = targetRate;
          video._skj_real_rate = targetRate;
          AppState.log(`已将视频播放倍速设置为: ${targetRate}x`);
        } finally {
          video._skj_setting_real_rate = false;
        }
      }
    }

    // 适配超星内部 Video.js 播放器实例
    if (ifrWin.videojs) {
      try {
        const players = ifrWin.videojs.players || {};
        const p = players[video.id] || (typeof ifrWin.videojs === 'function' ? ifrWin.videojs(video) : null);
        if (p) {
          // 解锁超星 studyControl 限制 (允许快进与切换窗口)
          if (p.studyControl) {
            p.studyControl.enableSwitchWindow = 1;
            p.studyControl.enableFastForward = 1;
          }
          if (typeof p.playbackRate === 'function' && Math.abs((p.playbackRate() || 1.0) - targetRate) > 0.05) {
            try {
              p.playbackRate(targetRate);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
  }

  /**
   * 处理暂停时的遮罩层、批注、继续播放提示
   */
  handlePauseArtifacts() {
    try {
      // 超星播放器暂停遮罩与继续学习按钮
      const resumeBtns = document.querySelectorAll('.sp_video_pic a.jb_btn, .ans-videoannotation .continueLearn');
      resumeBtns.forEach((btn) => {
        if (btn && btn.offsetParent !== null) {
          btn.removeAttribute('href');
          btn.click();
          AppState.log('已自动点击解除超星视频暂停遮罩');
        }
      });

      // 智慧树课程提醒弹窗
      const zhsPopClose = document.querySelector('.courseRemind.khfaPop .el-icon-error');
      if (zhsPopClose && zhsPopClose.offsetParent !== null) {
        zhsPopClose.click();
        AppState.log('已自动关闭智慧树弹窗提醒');
      }
    } catch (e) {}
  }

  /**
   * 处理视频内弹出测验 (弹题)
   */
  async handleVideoQuizzes(config) {
    // 1. 智慧树视频弹题 (#playTopic-dialog)
    const zhsDialog = document.querySelector('#playTopic-dialog');
    if (zhsDialog && zhsDialog.offsetParent !== null) {
      try {
        const vue = zhsDialog.__vue__?.$parent?.$parent;
        const topicInfo = vue?.topicInfo?.lessonTestQuestionUseInterfaceDtos?.[0];
        const options = topicInfo?.testQuestion?.questionOptions;
        const answers = topicInfo?.answerUs; // 智慧树前端直接暴露了正确答案 answerUs！

        if (vue && options && answers && typeof vue.topicClickQot === 'function') {
          const matches = options.filter((o) => o.sortUs && answers.includes(o.sortUs));
          for (const opt of matches) {
            vue.topicClickQot(opt);
            await new Promise((r) => setTimeout(r, 400));
          }
          setTimeout(() => {
            vue.testDialog = false;
            AppState.log('智慧树视频弹题已秒解并自动跳过！');
          }, 600);
          return;
        }
      } catch (e) {
        console.warn('[刷客酱] 智慧树原生弹题处理异常，尝试通用方式:', e);
      }
    }

    // 2. 超星视频弹题 (.ans-videoquiz)
    // 遍历所有 iframe 查找
    const frames = [document, ...Array.from(document.querySelectorAll('iframe')).map((f) => f.contentDocument).filter(Boolean)];
    for (const doc of frames) {
      const quizBox = doc.querySelector('.ans-videoquiz');
      if (quizBox && quizBox.offsetParent !== null && !quizBox._skj_solving) {
        quizBox._skj_solving = true;
        AppState.log('检测到超星视频随堂弹题，启动 AI 求解...');
        try {
          const stem = doc.querySelector('.ans-videoquiz .tkTopic')?.innerText || '';
          const opts = Array.from(doc.querySelectorAll('.ans-videoquiz-opt')).map((el) => el.innerText.trim());
          const prompt = buildQuestionPrompt('单选题', stem, opts);

          const aiAns = await requestOpenAI(prompt, null, config);
          const choice = parseAnswerFromLLM('单选题', aiAns);
          AppState.log(`AI 弹题回答: ${choice}`);

          // 查找对应选项并点击
          const optEls = Array.from(doc.querySelectorAll('.ans-videoquiz-opt'));
          const target = optEls.find((el) => {
            const m = el.innerText.trim().match(/([A-Ha-h])/);
            return m && m[1].toUpperCase() === choice;
          }) || optEls[0];

          if (target) {
            target.querySelector('input')?.click() || target.click();
            await new Promise((r) => setTimeout(r, 600));
            doc.querySelector('#videoquiz-submit')?.click();
            AppState.log('视频弹题已自动提交！');
          }
        } catch (err) {
          AppState.log('视频弹题求解失败: ' + err.message, 'error');
          // 失败时点第一个以尝试继续
          doc.querySelector('.ans-videoquiz-opt input')?.click();
          doc.querySelector('#videoquiz-submit')?.click();
        } finally {
          setTimeout(() => {
            doc.querySelector('#videoquiz-continue, #knowledgeBack')?.click();
            quizBox._skj_solving = false;
          }, 1200);
        }
      }
    }
  }

  /**
   * 自动跳转下一节 / 下一章
   */
  triggerNextChapter() {
    // 获取跨越 iframe 的顶层 document
    const topDoc = typeof window !== 'undefined' && window.top && window.top.document ? window.top.document : document;
    this._lastCompleteHandled = false;
    this._skipDebounce = false;

    // 1. 超星/学习通
    if (Site.isChaoxing) {
      // 查找章节顶部的标签卡（同一个小节可能含有视频、文档、作业等多个tab）
      const activeTab = topDoc.querySelector('#prev_tab .active, .prev_tab li.active');
      const allTabs = Array.from(topDoc.querySelectorAll('#prev_tab li, .prev_tab li'));
      if (activeTab && allTabs.length > 1) {
        const nextIdx = allTabs.indexOf(activeTab) + 1;
        if (nextIdx < allTabs.length) {
          AppState.log(`切换到当前章节的下一个标签卡 (${nextIdx + 1}/${allTabs.length})...`);
          allTabs[nextIdx].click();
          allTabs[nextIdx].querySelector('a')?.click();
          return;
        }
      }

      // 尝试让底部导航区域滚入视野（触发超星懒加载或检测）
      try {
        topDoc.querySelector('#prevNextFocus')?.scrollIntoView();
      } catch (e) {}

      // 点击页面底部的 "下一节" 按钮
      const nextBtn = topDoc.querySelector(
        '#prevNextFocusNext, .nextChapter, .next-node, #prevNextFocus .nextChapter, .orientationright'
      );
      if (nextBtn && window.getComputedStyle(nextBtn).display !== 'none') {
        AppState.log('点击超星【下一节】按钮');
        nextBtn.removeAttribute('href');
        nextBtn.click();
        this.handleJobFinishTips(topDoc);
        return;
      }

      // 尝试目录中的下一个节点
      const currentCatalog = topDoc.querySelector('.posCatalog_select, .leveltwo.active, .posCatalog_active');
      if (currentCatalog) {
        let nextNode = currentCatalog.nextElementSibling;
        while (nextNode && !nextNode.querySelector('a') && nextNode.tagName !== 'A') {
          nextNode = nextNode.nextElementSibling;
        }
        const link = nextNode?.querySelector('a') || (nextNode?.tagName === 'A' ? nextNode : null);
        if (link) {
          AppState.log('跳转至目录中的下一节课程');
          link.click();
          this.handleJobFinishTips(topDoc);
          return;
        }
      }
    }

    // 2. 智慧树
    if (Site.isZhihuishu) {
      // 当前小节资源列表中的下一项
      const resList = Array.from(topDoc.querySelectorAll('.resources-list .resources-item'));
      const activeRes = topDoc.querySelector('.resources-list .resources-item.active');
      if (activeRes && resList.length > 1) {
        const nextIdx = resList.indexOf(activeRes) + 1;
        if (nextIdx < resList.length) {
          AppState.log('切换至智慧树当前小节下一个资源');
          resList[nextIdx].click();
          return;
        }
      }

      // 章节目录中的下一个视频
      const videoItems = Array.from(topDoc.querySelectorAll('.inner-li li.clearfix.video'));
      const activeVideo = topDoc.querySelector('.inner-li li.clearfix.video.activeNode');
      if (activeVideo && videoItems.length > 1) {
        const nextIdx = videoItems.indexOf(activeVideo) + 1;
        if (nextIdx < videoItems.length) {
          AppState.log('跳转至智慧树下一个视频小节');
          videoItems[nextIdx].click();
          return;
        }
      }
    }

    // 3. 智慧职教 (ICVE)
    if (Site.isIcve) {
      const nodes = Array.from(topDoc.querySelectorAll('.panelList .node'));
      const activeNode = topDoc.querySelector('.panelList .node.active');
      if (activeNode) {
        const nextIdx = nodes.indexOf(activeNode) + 1;
        if (nextIdx < nodes.length) {
          AppState.log('跳转至智慧职教下一个学习单元');
          nodes[nextIdx].click();
          return;
        }
      }
    }

    // 4. 中国大学 MOOC
    if (Site.isMooc) {
      const nextMooc = topDoc.querySelector('.u-btn.u-btn-default.f-fr, .next-lesson');
      if (nextMooc) {
        AppState.log('点击中国大学MOOC【下一讲】');
        nextMooc.click();
        return;
      }
    }

    AppState.log('未检测到下一节按钮，课程可能已全部完成！', 'warn');
  }

  /**
   * 处理超星跳转下一节时可能弹出的“未完成任务点”提示弹窗
   */
  handleJobFinishTips(topDoc) {
    const checkTip = () => {
      try {
        const tip = topDoc.querySelector('.jobFinishTip, .popDiv[id*="job"], .popDiv');
        if (tip && window.getComputedStyle(tip).display !== 'none') {
          const confirmNext = tip.querySelector('.popBottom .nextChapter, .popConfirm, .jb_btn, a.nextChapter');
          if (confirmNext) {
            confirmNext.removeAttribute('href');
            confirmNext.click();
            AppState.log('已自动确认跳过超星未完成任务点提示弹窗');
          }
        }
      } catch (e) {}
    };
    setTimeout(checkTip, 800);
    setTimeout(checkTip, 2200);
    setTimeout(checkTip, 4500);
  }
}
