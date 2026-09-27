// ==UserScript==
// @name         刷客酱 - 网课视频助手 & AI解题助手
// @namespace    https://github.com/jellyfish-p/shuakejiang
// @version      2.0.5
// @description  超星学习通、智慧树等网课助手：支持视频自动播放、自动连播、倍速播放、静音、防暂停；解题助手全面升级为 OpenAI 兼容接口，支持自定义 API Key、Base URL 与模型名称（如 DeepSeek、GPT-4o 等），实现高精度题目识别与全自动答题！
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
            // 仅允许刷客酱内部设置真实底层播放倍速
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
      console.warn('[刷客酱] HOOK HTMLMediaElement 失败:', e);
    }
  }

  // 立即在当前窗口执行 (document-start)
  const rootWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  hookMediaWindow(rootWin);

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
        console.error('[刷客酱] 保存配置失败:', e);
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

    // AI 解题助手设置 (OpenAI 兼容格式)
    examEnabled: true,
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
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
      console.log(`[刷客酱][${time}] ${msg}`);
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
        // 原生 fetch 降级处理
        fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body)
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.choices?.[0]?.message?.content) {
              resolve(data.choices[0].message.content);
            } else {
              reject(new Error(data.error?.message || '请求失败'));
            }
          })
          .catch(reject);
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

  /* =========================================================================
   * 6. AI 解题助手核心实现 (DOM 提取、Prompt 组装、OpenAI 响应注入)
   * ========================================================================= */
  class ExamAssistant {
    constructor(videoAssist = null) {
      this.videoAssist = videoAssist;
      this.isBusy = false;
    }

    setVideoAssistant(videoAssist) {
      this.videoAssist = videoAssist;
    }

    /**
     * 自动检测当前页面类型并启动答题流程
     */
    async solveCurrentPage(manual = false) {
      if (this.isBusy) {
        AppState.log('解题任务正在运行中，请稍候...', 'warn');
        return;
      }

      const config = getConfig();
      if (!config.examEnabled && !manual) return;

      if (!config.openaiApiKey) {
        if (manual) AppState.log('请先在助手面板中配置 OpenAI API Key！', 'error');
        return;
      }

      this.isBusy = true;
      AppState.isSolvingQuiz = true;
      AppState.setStatus('正在解析页面题目...');

      try {
        // 1. 超星章节测验 (嵌套在 iframe#frame_content 中)
        const cxChapterFound = await this.solveChaoxingChapterTest(config);
        if (cxChapterFound) return;

        // 2. 超星独立作业与考试页 (.questionLi)
        const cxExamFound = await this.solveChaoxingExamPage(config);
        if (cxExamFound) return;

        // 3. 智慧树在线作业与考试
        const zhsExamFound = await this.solveZhihuishuExamPage(config);
        if (zhsExamFound) return;

        AppState.log('当前页面未检测到可解答的题目', 'warn');
      } catch (err) {
        AppState.log('答题异常: ' + err.message, 'error');
      } finally {
        this.isBusy = false;
        AppState.isSolvingQuiz = false;
        AppState.setStatus('空闲');
      }
    }

    /**
     * 解答超星学习通章节测验 (iframe 内嵌)
     */
    async solveChaoxingChapterTest(config) {
      // 遍历查找含有 #ZyBottom 的文档
      let targetDoc = null;
      try {
        const topIframe = document.querySelector('#iframe');
        if (topIframe) {
          const doc1 = topIframe.contentDocument;
          const innerIframe = doc1?.querySelector('#frame_content');
          if (innerIframe?.contentDocument?.querySelector('#ZyBottom')) {
            targetDoc = innerIframe.contentDocument;
          }
        }
        if (!targetDoc && document.querySelector('#ZyBottom')) {
          targetDoc = document;
        }
      } catch (e) {}

      if (!targetDoc) return false;

      // 检查当前测验是否已经提交或批阅完成 (无需作答)
      const statusEl = targetDoc.querySelector('.testTit_status, .ceyan_status');
      const isComplete =
        statusEl?.classList?.contains('testTit_status_complete') ||
        targetDoc.body?.innerText?.includes('待批阅') ||
        targetDoc.querySelector('.Zy_sub')?.innerText?.includes('已完成');

      if (isComplete) {
        AppState.log('检测到当前章节测验已完成，跳过作答');
        if (config.autoNext) {
          AppState.log('准备自动跳转下一节/下一章...');
          setTimeout(() => {
            if (this.videoAssist) {
              this.videoAssist.triggerNextChapter();
            } else {
              new VideoAssistant().triggerNextChapter();
            }
          }, 2000);
        }
        return true;
      }

      const questions = Array.from(targetDoc.querySelectorAll('#ZyBottom .singleQuesId'));
      if (questions.length === 0) return false;

      AppState.log(`检测到超星章节测验，共 ${questions.length} 道题`);

      for (let i = 0; i < questions.length; i++) {
        const qEl = questions[i];
        AppState.setStatus(`正在解答章节测验第 ${i + 1}/${questions.length} 题...`);

        try {
          // 题型识别
          const typeVal = parseInt(qEl.querySelector('input[id^="answertype"]')?.value || '0', 10);
          const typeMap = {
            0: '单选题',
            1: '多选题',
            2: '填空题',
            3: '判断题',
            4: '简答题',
            5: '名词解释',
            6: '论述题',
            7: '计算题',
            9: '分录题',
            10: '资料题',
            11: '连线题'
          };
          const questionType = typeMap[typeVal] || '单选题';

          // 题干与选项提取
          const stemEl = qEl.querySelector('.Zy_TItle');
          const stem = (stemEl ? stemEl.innerText : qEl.innerText).replace(/【.*?题】/, '').trim();

          const isMultiple = questionType === '多选题';
          const optEls = Array.from(
            qEl.querySelectorAll(isMultiple ? '.before-after-checkbox' : '.before-after')
          );
          const options = optEls.map((el) => el.innerText.trim());

          AppState.log(`[第${i + 1}题] ${questionType} - ${stem.slice(0, 30)}...`);

          // 请求大模型求解
          const prompt = buildQuestionPrompt(questionType, stem, options);
          const aiResponse = await requestOpenAI(prompt, null, config);
          const answer = parseAnswerFromLLM(questionType, aiResponse);
          AppState.log(`[第${i + 1}题] AI 回答: ${answer}`);

          // DOM 选项填入
          this.fillChaoxingChapterAnswer(qEl, questionType, answer, optEls);

          // 间隔延迟
          await new Promise((r) => setTimeout(r, config.solveInterval || 2000));
        } catch (err) {
          AppState.log(`[第${i + 1}题] 答题失败: ${err.message}`, 'error');
        }
      }

      // 暂存与自动提交处理
      AppState.log('章节测验全部题目解答完毕！');
      try {
        const saveBtn = targetDoc.querySelector('.ZY_sub .btnSave, .btnSave.workBtnIndex');
        if (saveBtn) {
          saveBtn.removeAttribute('href');
          saveBtn.click();
          AppState.log('已自动保存测验答案');
        }

        if (config.autoSubmit) {
          await new Promise((r) => setTimeout(r, 2000));
          const submitBtn = targetDoc.querySelector('.btnSubmit.workBtnIndex');
          if (submitBtn) {
            submitBtn.removeAttribute('href');
            submitBtn.click();
            // 确认弹窗
            setTimeout(() => {
              const confirmBtn = targetDoc.querySelector('#workpop .popConfirm, .workpop-confirm');
              confirmBtn?.click();
              AppState.log('已自动提交章节测验！');
            }, 1000);
          }
        }
      } catch (e) {}

      // 核心修复：作答完毕后自动跳转下一节/下一章
      if (config.autoNext) {
        AppState.log('章节测验已完成，准备自动跳转下一节/下一章...');
        setTimeout(() => {
          if (this.videoAssist) {
            this.videoAssist.triggerNextChapter();
          } else {
            new VideoAssistant().triggerNextChapter();
          }
        }, 3500);
      }

      return true;
    }

    /**
     * 填入超星章节测验 DOM
     */
    fillChaoxingChapterAnswer(qEl, questionType, answer, optEls) {
      if (questionType === '单选题') {
        const target = optEls.find((el) => {
          const txt = el.innerText.trim();
          const m = txt.match(/([A-Ha-h])/);
          return (m && m[1].toUpperCase() === answer) || txt === answer;
        });
        if (target) {
          const input = target.querySelector('[name^=answer]');
          if (!input?.classList.contains('check_answer') && !input?.classList.contains('check_answer_dx')) {
            target.click();
          }
        }
      } else if (questionType === '多选题') {
        optEls.forEach((el) => {
          const m = el.innerText.trim().match(/([A-Ha-h])/);
          const letter = m ? m[1].toUpperCase() : '';
          const input = el.querySelector('[name^=answercheck]');
          const isSelected = input?.classList.contains('check_answer') || input?.classList.contains('check_answer_dx');
          const shouldSelect = letter && answer.includes(letter);
          if (shouldSelect !== isSelected) {
            el.click();
          }
        });
      } else if (questionType === '判断题') {
        const target = optEls.find((el) => {
          const txt = el.innerText.trim();
          return txt.includes(answer.charAt(0));
        }) || optEls[0];
        target?.click();
      } else if (questionType === '填空题') {
        const blanks = Array.from(qEl.querySelectorAll('.blankItemDiv'));
        const parts = answer.split('#');
        blanks.forEach((blank, idx) => {
          const val = (parts[idx] || parts[0] || '').trim();
          const ta = blank.querySelector('textarea');
          const inpDiv = blank.querySelector('.InpDIV');
          if (ta) ta.value = val;
          if (inpDiv) inpDiv.innerHTML = `<p>${val}</p>`;
        });
      } else {
        // 简答题
        const ta = qEl.querySelector('.Zy_ulTk textarea');
        if (ta) ta.value = answer;
      }
    }

    /**
     * 解答超星独立作业与考试页 (.questionLi)
     */
    async solveChaoxingExamPage(config) {
      const questions = Array.from(document.querySelectorAll('.questionLi'));
      if (questions.length === 0) return false;

      AppState.log(`检测到超星作业/考试页面，共 ${questions.length} 道题`);

      for (let i = 0; i < questions.length; i++) {
        const qEl = questions[i];
        AppState.setStatus(`正在解答作业/考试第 ${i + 1}/${questions.length} 题...`);

        try {
          // 题型识别
          const titleEl = qEl.querySelector('h3, .Zy_TItle');
          const titleText = titleEl ? titleEl.innerText : qEl.innerText;
          const typeMatch = titleText.match(/([一-龥]+题)/);
          const questionType = typeMatch ? typeMatch[1] : '单选题';

          const stem = titleText.replace(/【.*?题】|\d+\s*[\.、]/, '').trim();

          // 选项提取
          const optEls = Array.from(qEl.querySelectorAll('.answerBg'));
          const options = optEls.map((el) => el.innerText.trim());

          AppState.log(`[第${i + 1}题] ${questionType} - ${stem.slice(0, 30)}...`);

          // 请求大模型
          const prompt = buildQuestionPrompt(questionType, stem, options);
          const aiResponse = await requestOpenAI(prompt, null, config);
          const answer = parseAnswerFromLLM(questionType, aiResponse);
          AppState.log(`[第${i + 1}题] AI 回答: ${answer}`);

          // 填入选项
          this.fillChaoxingExamAnswer(qEl, questionType, answer, optEls);

          await new Promise((r) => setTimeout(r, config.solveInterval || 2000));
        } catch (err) {
          AppState.log(`[第${i + 1}题] 答题异常: ${err.message}`, 'error');
        }
      }

      AppState.log('超星作业/考试所有题目解答完成！');
      try {
        const tempSave = document.querySelector('#submitFocus a, .btnSave');
        if (tempSave && tempSave.innerText.includes('暂存')) {
          tempSave.click();
          AppState.log('已自动点击暂时保存');
        }

        if (config.autoSubmit) {
          const completeBtn = document.querySelector('a.completeBtn, .btnSubmit');
          if (completeBtn) {
            completeBtn.click();
            setTimeout(() => {
              document.querySelector('#popok, .popBottom .confirm')?.click();
              AppState.log('已自动确认提交作业/考试！');
            }, 1000);
          }
        }
      } catch (e) {}

      return true;
    }

    /**
     * 填入超星作业/考试选项
     */
    fillChaoxingExamAnswer(qEl, questionType, answer, optEls) {
      if (questionType.includes('单选')) {
        const target = optEls.find((el) => {
          const txt = el.innerText.trim();
          const m = txt.match(/([A-Ha-h])/);
          return (m && m[1].toUpperCase() === answer) || txt === answer;
        });
        if (target) {
          const icon = target.querySelector('.num_option');
          if (!icon?.classList.contains('check_answer')) {
            target.click();
          }
        }
      } else if (questionType.includes('多选')) {
        optEls.forEach((el) => {
          const m = el.innerText.trim().match(/([A-Ha-h])/);
          const letter = m ? m[1].toUpperCase() : '';
          const icon = el.querySelector('.num_option_dx, .num_option');
          const isSelected = icon?.classList.contains('check_answer') || icon?.classList.contains('check_answer_dx');
          const shouldSelect = letter && answer.includes(letter);
          if (shouldSelect !== isSelected) {
            el.click();
          }
        });
      } else if (questionType.includes('判断')) {
        const target = optEls.find((el) => {
          const txt = el.innerText.trim();
          return txt.includes(answer.charAt(0));
        }) || optEls[0];
        target?.click();
      } else {
        // 填空或简答
        const textareas = Array.from(qEl.querySelectorAll('.Answer textarea, .stem_answer textarea'));
        const parts = answer.split('#');
        textareas.forEach((ta, idx) => {
          const val = (parts[idx] || parts[0] || '').trim();
          ta.value = val;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    }

    /**
     * 解答智慧树作业/考试
     */
    async solveZhihuishuExamPage(config) {
      const container = document.querySelector('.questionContent, .exam-test, .ET-content');
      if (!container) return false;

      AppState.log('检测到智慧树作业/考试页面');
      const stem = container.querySelector('.questionTit, .subject-title')?.innerText || '';
      const typeEl = container.querySelector('.questionType, .subject-type');
      const questionType = typeEl ? typeEl.innerText.trim() : '单选题';

      const optEls = Array.from(container.querySelectorAll('.optionItem, .el-radio, .el-checkbox, .answerBg'));
      const options = optEls.map((el) => el.innerText.trim());

      AppState.log(`[智慧树题目] ${questionType} - ${stem.slice(0, 30)}...`);

      const prompt = buildQuestionPrompt(questionType, stem, options);
      const aiResponse = await requestOpenAI(prompt, null, config);
      const answer = parseAnswerFromLLM(questionType, aiResponse);
      AppState.log(`AI 回答: ${answer}`);

      // 智慧树填入选项
      if (questionType.includes('单选') || questionType.includes('判断')) {
        const target = optEls.find((el) => {
          const txt = el.innerText.trim();
          const m = txt.match(/([A-Ha-h])/);
          return (m && m[1].toUpperCase() === answer) || txt.includes(answer.charAt(0));
        });
        target?.click();
      } else if (questionType.includes('多选')) {
        optEls.forEach((el) => {
          const m = el.innerText.trim().match(/([A-Ha-h])/);
          const letter = m ? m[1].toUpperCase() : '';
          if (letter && answer.includes(letter)) {
            el.click();
          }
        });
      }

      // 下一题按钮
      await new Promise((r) => setTimeout(r, config.solveInterval || 2000));
      const nextBtn = document.querySelector('.pre-next .next-t, .btn-next');
      if (nextBtn && nextBtn.offsetParent !== null) {
        nextBtn.click();
        AppState.log('已自动点击下一题');
      }

      return true;
    }
  }

  /* =========================================================================
   * 控制面板样式表
   * ========================================================================= */
  const UI_STYLES = `
          /* 刷客酱主容器与字体 */
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
        GM_registerMenuCommand('⚙️ 打开刷客酱设置', () => this.toggleModal(true));
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
        <div id="skj-widget-logo">🤖 刷客酱</div>
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
              <span>🤖 刷客酱控制台</span>
              <span class="skj-badge">v2.0.0</span>
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

              <div class="skj-form-item" style="margin-top: 12px;">
                <div class="skj-form-label">API 接口地址 (Base URL)</div>
                <input type="text" class="skj-input" id="skj-cfg-openaiBaseUrl" placeholder="https://api.openai.com/v1" value="${cfg.openaiBaseUrl}">
                <div class="skj-form-desc">支持任意 OpenAI 兼容地址，例如 DeepSeek、OneAPI、SiliconFlow 或本地 Ollama</div>
              </div>

              <div class="skj-form-item">
                <div class="skj-form-label">API Key (密钥)</div>
                <input type="password" class="skj-input" id="skj-cfg-openaiApiKey" placeholder="sk-..." value="${cfg.openaiApiKey}">
                <div class="skj-form-desc">密钥仅保存在您本地油猴存储中，绝不上传至任何第三方服务器</div>
              </div>

              <div class="skj-form-item">
                <div class="skj-form-label">模型名称 (Model)</div>
                <input type="text" class="skj-input" id="skj-cfg-openaiModel" placeholder="gpt-4o-mini" value="${cfg.openaiModel}">
                <div class="skj-form-desc">例如：gpt-4o-mini、deepseek-chat、qwen-turbo、claude-3-haiku 等</div>
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

              <div style="display: flex; gap: 10px; margin-top: 16px;">
                <button class="skj-btn skj-btn-secondary" id="skj-test-ai-btn">⚡ 测试 API 连接</button>
                <button class="skj-btn skj-btn-primary" id="skj-save-ai-btn">💾 保存全部设置</button>
              </div>
            </div>
          </div>

          <!-- 弹窗全局底部操作栏 -->
          <div class="skj-footer">
            <div class="skj-footer-status" id="skj-save-tip">
              <span>⚡ 设置变动实时自动保存并生效</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="skj-btn skj-btn-secondary" id="skj-modal-close-bottom-btn" style="padding: 6px 14px;">关闭</button>
              <button class="skj-btn skj-btn-primary" id="skj-save-global-btn" style="padding: 6px 16px;">💾 保存设置</button>
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

      // 保存设置按钮
      const onSaveClicked = () => {
        this.saveCurrentInputs(false);
        alert('配置已成功保存并即时生效！');
      };
      document.getElementById('skj-save-ai-btn')?.addEventListener('click', onSaveClicked);
      document.getElementById('skj-save-global-btn')?.addEventListener('click', onSaveClicked);
      document.getElementById('skj-modal-close-bottom-btn')?.addEventListener('click', () => {
        this.toggleModal(false);
      });

      // 监听所有输入控件变动，实现全自动即时保存
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
            this.saveCurrentInputs(true);
          });
        }
      });

      // 文本输入框变动防抖自动保存
      ['skj-cfg-openaiBaseUrl', 'skj-cfg-openaiApiKey', 'skj-cfg-openaiModel'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', () => {
            if (this._inputSaveTimer) clearTimeout(this._inputSaveTimer);
            this._inputSaveTimer = setTimeout(() => {
              this.saveCurrentInputs(true);
            }, 400);
          });
        }
      });

      // 测试 API
      document.getElementById('skj-test-ai-btn')?.addEventListener('click', async () => {
        this.saveCurrentInputs();
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

    saveCurrentInputs(silent = false) {
      const rateEl = document.getElementById('skj-cfg-playbackRate');

      // 读取已存储的配置，防止切换标签页或部分控件为空时意外抹除已配置的 API 信息
      const curBaseUrl = Storage.get('openaiBaseUrl', DEFAULT_CONFIG.openaiBaseUrl);
      const curApiKey = Storage.get('openaiApiKey', '');
      const curModel = Storage.get('openaiModel', DEFAULT_CONFIG.openaiModel);

      const inputBaseUrl = document.getElementById('skj-cfg-openaiBaseUrl')?.value.trim();
      const inputApiKey = document.getElementById('skj-cfg-openaiApiKey')?.value.trim();
      const inputModel = document.getElementById('skj-cfg-openaiModel')?.value.trim();

      const newCfg = {
        videoEnabled: document.getElementById('skj-cfg-videoEnabled')?.checked ?? true,
        autoNext: document.getElementById('skj-cfg-autoNext')?.checked ?? true,
        skipFinished: document.getElementById('skj-cfg-skipFinished')?.checked ?? true,
        muted: document.getElementById('skj-cfg-muted')?.checked ?? true,
        autoSolveVideoQuiz: document.getElementById('skj-cfg-autoSolveVideoQuiz')?.checked ?? true,
        playbackRate: parseFloat(rateEl?.value || '1.0'),

        examEnabled: document.getElementById('skj-cfg-examEnabled')?.checked ?? true,
        // 跨域全局共享保护：有输入则更新，为空且已有存储则保留已有配置
        openaiBaseUrl: inputBaseUrl || curBaseUrl || DEFAULT_CONFIG.openaiBaseUrl,
        openaiApiKey: inputApiKey !== undefined && inputApiKey !== '' ? inputApiKey : curApiKey,
        openaiModel: inputModel || curModel || DEFAULT_CONFIG.openaiModel,
        autoSubmit: document.getElementById('skj-cfg-autoSubmit')?.checked ?? true
      };
      setConfig(newCfg);

      // 立即向当前页面所有视频同步新设定的倍速和静音状态
      const videos = this.videoAssist.findMediaElements();
      for (const v of videos) {
        if (newCfg.muted && !v.muted) v.muted = true;
        this.videoAssist.applyPlaybackRate(v, newCfg.playbackRate);
      }

      // 底部状态栏动效反馈
      const tip = document.getElementById('skj-save-tip');
      if (tip) {
        tip.innerHTML = '<span style="color:#10b981;font-weight:600;">✅ 设置已自动保存并即时生效</span>';
        if (this._tipTimer) clearTimeout(this._tipTimer);
        this._tipTimer = setTimeout(() => {
          tip.innerHTML = '<span>⚡ 设置变动实时自动保存并生效</span>';
        }, 2000);
      }

      if (!silent) {
        AppState.log(`设置已保存！视频倍速: ${newCfg.playbackRate}x`);
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
   * ========================================================================= */
  function main() {
    const videoAssist = new VideoAssistant();
    const examAssist = new ExamAssistant(videoAssist);
    videoAssist.setExamAssistant(examAssist);
    const ui = new UIController(videoAssist, examAssist);

    // 1. 初始化界面 (仅在顶层窗口运行)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        ui.init();
      });
    } else {
      ui.init();
    }

    // 2. 启动视频监控服务
    videoAssist.start();

    // 3. 页面加载完成后，若为独立作业/考试页面且开启了自动答题，则延时自动触发
    window.addEventListener('load', () => {
      const cfg = getConfig();
      if (cfg.examEnabled) {
        if (Site.isCxWorkOrExam || Site.isZhsExam) {
          setTimeout(() => {
            examAssist.solveCurrentPage(false);
          }, 3000);
        } else if (Site.isCxStudentStudy) {
          // 超星学习任务页：延迟检测首屏是否直接是章节测验
          setTimeout(() => {
            videoAssist.checkAndSolveChapterQuiz(cfg);
          }, 3500);
        }
      }
    });

    console.log('[刷客酱] 网课助手与 AI 解题助手启动就绪！');
  }

  main();
})();
