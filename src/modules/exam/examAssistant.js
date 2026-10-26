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
    const iframe = await CxDom.resolveTaskIframe(studyDoc, workTask, 20000);
    if (!iframe) return false;

    const doc = await skjWaitFor(() => CxDom.workDocReady(iframe), { timeout: 30000, interval: 500 });
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

    const questions = Array.from(doc.querySelectorAll('#ZyBottom .singleQuesId'));
    if (!questions.length) {
      AppState.log('当前测验未识别到题目，已暂存后跳过', 'warn');
      const reason = await this.saveCxWork(doc, { submit: false, cancelled, allowDisabled: !respectEnabled });
      if (reason === 'cancelled') return { status: 'paused', reason, submitSafe: false };
      return { status: 'done', reason: 'no_question', submitSafe: false };
    }

    AppState.log(`检测到章节测验，共 ${questions.length} 道题，开始 AI 作答...`);
    const stopped = () => cancelled() || (respectEnabled && !getConfig().examEnabled);
    const { ok, failed, aborted } = await this.solveQuestionBatches(questions, config, {
      label: '章节测验', stopped, fontProtection: true,
      extract: (qEl, readText) => {
        const type = this.getCxQuestionType(qEl, readText);
        return { type, ...this.extractCxQuestion(qEl, type, readText) };
      },
      fill: (qEl, question, answer) => this.fillCxQuestion(qEl, question.type, answer, question.optEls, question.options)
    });
    if (aborted) return { status: 'paused', reason: 'cancelled', submitSafe: false };

    AppState.log(`章节测验作答完成：成功 ${ok} 题${failed ? `，失败 ${failed} 题` : ''}`);
    if (cancelled() || (respectEnabled && !getConfig().examEnabled)) {
      return { status: 'paused', reason: 'cancelled', submitSafe: false };
    }

    const liveConfig = getConfig();
    if (liveConfig.autoSubmit && failed === 0) {
      const reason = await this.saveCxWork(doc, {
        submit: true,
        cancelled,
        allowDisabled: !respectEnabled
      });
      if (reason === 'cancelled') return { status: 'paused', reason, submitSafe: false };
      return { status: 'done', reason, submitSafe: reason === 'submitted' };
    }
    const saved = await this.saveCxWork(doc, { submit: false, cancelled, allowDisabled: !respectEnabled });
    if (saved === 'cancelled') return { status: 'paused', reason: saved, submitSafe: false };
    return {
      status: saved === 'error' ? 'failed' : 'done',
      reason: saved === 'error' ? saved : failed ? `partial_saved(${failed}题未完成)` : saved,
      submitSafe: false
    };
  }

  /** 共用批处理：限量并发请求，全部收齐后串行填答；缺失/非法答案不猜测。 */
  async solveQuestionBatches(elements, config, { label, extract, fill, stopped = () => false, fontProtection = false }) {
    let ok = 0, failed = 0, reader = null;
    const plainText = el => el?.innerText || '';
    if (fontProtection) {
      const stopRequested = stopped;
      const keys = ['cxFontStrategy', 'cxVisionUseMain', 'cxVisionBaseUrl', 'cxVisionApiKey', 'cxVisionModel',
        'openaiBaseUrl', 'openaiApiKey', 'openaiModel'];
      stopped = () => {
        const live = getConfig();
        return stopRequested() || keys.some(key => (live[key] ?? DEFAULT_CONFIG[key]) !== (config[key] ?? DEFAULT_CONFIG[key]));
      };
      try {
        reader = await CxFont.prepare(elements, config, { cancelled: stopped });
        if (reader.characters) AppState.log(`[${label}] 字体还原完成：${reader.strategy === 'table' ? '本地查表' : '图片视觉'}，${reader.characters} 个去重汉字`);
      } catch (err) {
        if (stopped()) return { ok, failed, aborted: true };
        AppState.log(`[${label}] 字体还原失败，已阻止本页解题与提交：${err.message}`, 'error');
        return { ok, failed: elements.length, aborted: false };
      }
    }
    // 某个并发槽观察到取消后，整个任务保持取消；重新开启助手不能复活旧请求。
    const stopRequested = stopped;
    let aborted = false;
    stopped = () => (aborted = aborted || stopRequested());

    // 调度参数使用本次配置快照；修改面板只影响下一次答题。
    const { batchSize, concurrency } = getCxRequestSettings(config);
    const batches = [];
    let nextStart = 0;
    const requestWorker = async () => {
      while (nextStart < elements.length) {
        if (stopped()) return;
        const start = nextStart;
        nextStart += batchSize;
        const batch = [];
        const result = { batch, answers: null };
        batches[start / batchSize] = result;
        for (let i = start; i < Math.min(start + batchSize, elements.length); i++) {
          try {
            reader?.assertCurrent();
            const data = extract(elements[i], reader ? reader.readText : plainText);
            if (!String(data.stem || '').trim()) throw new Error('题干为空');
            batch.push({ ...data, id: `q${i + 1}`, title: data.stem, element: elements[i] });
          } catch (err) {
            failed++;
            AppState.log(`[${label} ${i + 1}] 题目提取失败: ${err.message}`, 'error');
          }
        }
        if (batch.length) {
          AppState.setStatus(`正在解答${label} ${start + 1}-${Math.min(start + batchSize, elements.length)}/${elements.length}（${concurrency} 路并发）...`);
          try {
            if (stopped()) return;
            reader?.assertCurrent();
            result.answers = await requestQuestionBatch(
              batch.map(({ id, type, title, options }) => ({ id, type, title, options })), config
            );
            if (stopped()) return;
            reader?.assertCurrent();
          } catch (err) {
            result.answers = null;
            failed += batch.length;
            AppState.log(`[${label} ${start + 1}-${Math.min(start + batchSize, elements.length)}] 本批请求/JSON 解析失败: ${err.message}`, 'error');
          }
        }
        if (stopped()) return;
        // 保留每个请求槽的节流间隔；其他槽无需等待本批响应。
        if (nextStart < elements.length) await skjSleep(Math.max(800, Number(config.solveInterval) || 1500));
      }
    };
    const workers = Math.min(concurrency, Math.ceil(elements.length / batchSize));
    // 取消时也等待已发出的请求收尾，避免释放单飞锁后旧请求与新任务叠加。
    await Promise.all(Array.from({ length: workers }, () => requestWorker()));
    if (stopped()) return { ok, failed, aborted: true };

    // 请求完成顺序不决定填答顺序，DOM 操作与最后的暂存/提交都保持串行。
    for (const { batch, answers } of batches) {
      if (!answers) continue;
      for (const question of batch) {
        if (stopped()) return { ok, failed, aborted: true };
        try {
          reader?.assertCurrent();
          if (question.element.isConnected === false) throw new Error('题目已离开页面');
          if (!answers.has(question.id)) throw new Error('JSON 答案缺失或无效');
          const answer = answers.get(question.id);
          if (!await fill(question.element, question, answer)) throw new Error('答案未能填入或选中状态校验失败');
          ok++;
          AppState.log(`[${label} ${question.id.slice(1)}] ${question.type} → ${JSON.stringify(answer)}`);
        } catch (err) {
          failed++;
          AppState.log(`[${label} ${question.id.slice(1)}] 作答失败: ${err.message}`, 'error');
        }
      }
    }
    return { ok, failed, aborted: stopped() };
  }

  /** 识别章节测验题目类型 */
  getCxQuestionType(qEl, readText = el => el?.innerText || '') {
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
    const title = readText(qEl.querySelector('.Zy_TItle')) || readText(qEl);
    const m = title.match(/【([^】]+题)】/);
    return m ? m[1] : '单选题';
  }

  /** 提取章节测验题干与选项 */
  extractCxQuestion(qEl, questionType, readText = el => el?.innerText || '') {
    const isMulti = questionType === '多选题';
    let optEls = Array.from(qEl.querySelectorAll(isMulti ? '.before-after-checkbox' : '.before-after'));
    if (!optEls.length) optEls = Array.from(qEl.querySelectorAll('.before-after, .before-after-checkbox'));
    const stemEl = qEl.querySelector('.Zy_TItle');
    const stem = readText(stemEl || qEl)
      .replace(/【[^】]*】/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const options = optEls.map((el) => readText(el).trim());
    return { stem, options, optEls };
  }

  /** 按题型填入章节测验答案 */
  fillCxQuestion(qEl, questionType, answer, optEls, optionTexts = null) {
    const list = optEls && optEls.length ? optEls : Array.from(qEl.querySelectorAll('.before-after, .before-after-checkbox'));

    if (/单选|多选|判断/.test(questionType)) return skjFillChoice(list, questionType, answer, optionTexts);

    if (questionType === '填空题' || questionType === '分录题' || questionType === '资料题' || questionType === '完形填空') {
      const blanks = Array.from(qEl.querySelectorAll('.blankItemDiv'));
      if (!blanks.length) return false;
      const parts = Array.isArray(answer) ? answer : String(answer).split('#');
      if (parts.length !== blanks.length || parts.some(part => !part.trim())) return false;
      return blanks.map((blank, i) => this.fillTextAnswer(blank, parts[i])).every(Boolean);
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

  /** 同时同步 textarea 与富文本编辑器，避免只改显示层而未保存答案。 */
  fillTextAnswer(block, value) {
    if (!String(value).trim()) return false;
    let filled = false;
    const textarea = block.querySelector('textarea') || block.querySelector('input[type="text"]');
    if (textarea && !textarea.disabled && !textarea.readOnly) {
      textarea.value = value;
      skjFireInput(textarea);
      filled = textarea.value === value;
    }
    const inpDiv = block.querySelector('.InpDIV');
    if (inpDiv) {
      inpDiv.innerHTML = `<p>${skjEscapeHtml(value)}</p>`;
      skjFireInput(inpDiv);
      filled = true;
    }
    try {
      const body = block.querySelector('iframe')?.contentDocument?.body;
      if (body) {
        body.innerHTML = `<p>${skjEscapeHtml(value)}</p>`;
        skjFireInput(body);
        filled = true;
      }
    } catch (e) {}
    return filled;
  }

  /** 连线题在全部匹配成功后同步填入，不留下提交之后才执行的定时器。 */
  fillCxLineAnswer(qEl, answer) {
    const list = qEl.querySelector('.beautiSelect .thirdUlList');
    if (!list) return false;
    const parts = String(answer).split(/[\n,]/);
    const entries = parts.map(part => {
      const m = part.replace(/[-、\s.#]/g, '').match(/^(\d+)([A-Za-z]+)$/);
      const li = m && list.querySelector(`li[index="${m[1]}"]`);
      const option = li && li.querySelector(`[value="${m[2].toUpperCase()}"]`);
      return option ? { li, option, value: m[2].toUpperCase() } : null;
    });
    if (!entries.length || entries.some(entry => !entry)) return false;
    for (const { li, option, value } of entries) {
      option.selected = true;
      const label = li.querySelector('.chosen-single span');
      if (label) label.innerText = value;
      skjFireInput(option.closest('select') || option);
    }
    return entries.every(({ option }) => option.selected);
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
          const popup = this.workPopupRoot(el);
          if (popup && skjIsDeepVisible(popup)) return popup;
        } catch (e) {}
      }
    }
    return null;
  }

  /** #workpopFocus 在实际学习页只是标题栏，正文/按钮位于外围 #workpop。 */
  workPopupRoot(el) {
    if (!el) return null;
    return el.closest('#workpop, .workpop, #popup_container') || el;
  }

  /** 定位当前聚焦提示所属的完整弹窗，兼容独立的旧式弹窗。 */
  findFocusPopup(extra = []) {
    const docs = this.collectDocs(extra);
    for (const doc of docs) {
      try {
        const popup = this.workPopupRoot(doc.getElementById('workpopFocus'));
        if (popup && skjIsDeepVisible(popup)) return popup;
      } catch (e) {}
    }
    return null;
  }

  readPopupContent(extra = [], popup = null) {
    const docs = popup ? [popup] : this.collectDocs(extra);
    for (const selector of ['#popcontent', '.popcontent', '.popBottom .content']) {
      const el = skjQueryDocs(docs, selector);
      if (el) return el.innerText || '';
    }
    return popup?.innerText || '';
  }

  clickPopupButton(extra = [], selector = '', popup = null) {
    const roots = popup ? [popup] : this.collectDocs(extra);
    for (const root of roots) {
      const el = Array.from(root.querySelectorAll(selector)).find(skjIsDisplayed);
      if (el) return skjHumanClick(el);
    }
    return false;
  }

  /**
   * 章节测验暂存 / 提交
   * @returns 'saved'|'submitted'|'submitted_unverified'|'incomplete'|'nopass'|'error'
   */
  async saveCxWork(doc, options = {}) {
    const submit = !!options.submit;
    const allowDisabled = !!options.allowDisabled;
    const cancelled = typeof options.cancelled === 'function' ? options.cancelled : () => false;
    const canSubmit = () => !cancelled() && (allowDisabled || getConfig().examEnabled) && getConfig().autoSubmit;
    try {
      if (cancelled()) return 'cancelled';
      // 1) 暂存答案
      const saveBtn = doc.querySelector('.btnSave.workBtnIndex, .ZY_sub .btnSave, .btnSave');
      if (saveBtn) {
        skjHumanClick(saveBtn);
        AppState.log('已暂存章节测验答案');
      }
      await skjSleep(1200);
      if (cancelled()) return 'cancelled';
      if (!submit) return 'saved';
      if ((!allowDisabled && !getConfig().examEnabled) || !getConfig().autoSubmit) return 'cancelled';

      // 2) 提交：先等待平台同步答案，再重新查找当前提交按钮。
      // 超星可能在暂存/重绘时替换按钮，不能继续点击旧节点，否则确认弹窗不会出现。
      await skjSleep(500);
      if (!canSubmit()) return 'cancelled';
      const submitBtn = await skjWaitFor(
        () => {
          const btn = doc.querySelector('.btnSubmit.workBtnIndex, .btnSubmit');
          return btn && skjIsDisplayed(btn) ? btn : null;
        },
        { timeout: 3000, interval: 200, cancelled: () => !canSubmit() }
      );
      if (!canSubmit()) return 'cancelled';
      if (!submitBtn) {
        AppState.log('未找到当前测验提交按钮，已保留暂存结果', 'warn');
        return 'saved';
      }
      if (!skjHumanClick(submitBtn)) return 'error';

      // 3) 结果弹窗判定（对齐参考扩展：未做完 / 未达到及格线 自动取消）
      const popup = await skjWaitFor(() => this.findVisiblePopup([doc]), {
        timeout: 8000,
        interval: 250,
        cancelled: () => !canSubmit()
      });
      if (!canSubmit()) return 'cancelled';
      if (popup) {
        // 给平台弹窗事件绑定/重绘留出时间；等待后重新校验开关、弹窗及提示内容。
        await skjSleep(300);
        if (!canSubmit() || popup.isConnected === false || !skjIsDeepVisible(popup) ||
            this.findVisiblePopup([doc]) !== popup) return 'cancelled';
        const content = this.readPopupContent([doc], popup);
        if (/未做完|未完成|未作答|漏答/.test(content)) {
          this.clickPopupButton([doc], '#popno, .popno', popup);
          AppState.log('平台提示仍有未作答题目，已取消提交（答案已暂存）', 'warn');
          return 'incomplete';
        }
        if (content.includes('未达到及格线')) {
          this.clickPopupButton([doc], '#popno, .popno', popup);
          AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
          return 'nopass';
        }
        if (!canSubmit()) return 'cancelled';
        if (!this.clickPopupButton([doc], '#popok, .popok', popup)) return 'error';
        AppState.log('已自动确认提交章节测验');

        // 3.1 workPop() 会复用同一遮罩；标题栏存在不代表出现了新提示。
        // 等待原弹窗关闭后重开、正文变化或新弹窗，不能立即重复确认旧弹窗。
        let previousClosed = false;
        const followup = await skjWaitFor(() => {
          if (CxDom.isWorkResultView(doc) ||
              ['complete', 'pendingReview', 'teacherIncomplete'].includes(CxDom.workStatus(doc))) {
            return { finished: true };
          }
          if (!skjIsDeepVisible(popup)) previousClosed = true;
          const next = this.findFocusPopup([doc]) || this.findVisiblePopup([doc]);
          if (!next) previousClosed = true;
          if (next && (next !== popup || previousClosed || this.readPopupContent([doc], next) !== content)) {
            return { popup: next };
          }
          return null;
        }, {
          timeout: 6000,
          interval: 300,
          cancelled: () => !canSubmit()
        });
        if (!canSubmit()) return 'cancelled';
        const focusPopup = followup?.popup;
        if (focusPopup) {
          await skjSleep(300);
          if (!canSubmit() || focusPopup.isConnected === false || !skjIsDeepVisible(focusPopup) ||
              (this.findFocusPopup([doc]) || this.findVisiblePopup([doc])) !== focusPopup) return 'cancelled';
          const focusText = this.readPopupContent([doc], focusPopup);
          if (/未做完|未完成|未作答|漏答/.test(focusText)) {
            this.clickPopupButton([doc], '#popno, .popno', focusPopup);
            AppState.log('平台后续提示仍有未作答题目，已取消提交', 'warn');
            return 'incomplete';
          }
          if (focusText.includes('未达到及格线')) {
            this.clickPopupButton([doc], '#popno, .popno', focusPopup);
            AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
            return 'nopass';
          }
          if (!canSubmit()) return 'cancelled';
          if (!this.clickPopupButton([doc], '#popok, .popok', focusPopup)) return 'error';
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
  detectQuestionLiType(qEl, readText = el => el?.innerText || '') {
    const title = readText(qEl.querySelector('.mark_name .colorShallow, h3, .Zy_TItle'));
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
    const m = (title + readText(qEl)).match(/【([^】]+题)】/);
    return m ? m[1] : '单选题';
  }

  async solveChaoxingQuestionLiPage(config, allowDisabled = false) {
    const questions = Array.from(document.querySelectorAll('.questionLi'));
    if (!questions.length) return false;

    AppState.log(`检测到超星作业/考试页面，共 ${questions.length} 道题`);
    const href = location.href;
    const stopped = () => location.href !== href || (!allowDisabled && !getConfig().examEnabled);
    const { ok, failed, aborted } = await this.solveQuestionBatches(questions, config, {
      label: '作业/考试', stopped, fontProtection: true,
      extract: (qEl, readText) => {
        const type = this.detectQuestionLiType(qEl, readText);
        const stemEl = qEl.querySelector('.mark_name .qtContent, h3, .Zy_TItle');
        const stem = readText(stemEl || qEl)
          .replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim();
        const optEls = Array.from(qEl.querySelectorAll('.answerBg'));
        return { type, stem, options: optEls.map(el => readText(el).trim()), optEls };
      },
      fill: (qEl, question, answer) => this.fillQuestionLiAnswer(qEl, question.type, answer, question.optEls, question.options)
    });
    if (aborted) return true;

    AppState.log(`作业/考试作答完成：成功 ${ok} 题${failed ? `，失败 ${failed} 题` : ''}`);
    await this.saveQuestionLiPage(config, failed, allowDisabled, stopped);
    return true;
  }

  /** 填入 .questionLi 结构答案（对齐参考扩展 cxExam 的填入逻辑） */
  fillQuestionLiAnswer(qEl, questionType, answer, optEls, optionTexts = null) {
    const list = optEls && optEls.length ? optEls : Array.from(qEl.querySelectorAll('.answerBg'));
    try {
      qEl.scrollIntoView({ block: 'center' });
    } catch (e) {}

    if (/单选|多选|判断/.test(questionType)) return skjFillChoice(list, questionType, answer, optionTexts);

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
      const parts = Array.isArray(answer) ? answer : String(answer).replace(/^#+|#+$/g, '').split('#');
      if (parts.length !== blanks.length || parts.some(part => !part.trim())) return false;
      return blanks.map((blank, i) => this.fillTextAnswer(blank, parts[i])).every(Boolean);
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
  async saveQuestionLiPage(config, failedCount = 0, allowDisabled = false, cancelled = () => false) {
    const canSubmit = () => !cancelled() && (allowDisabled || getConfig().examEnabled) && getConfig().autoSubmit;
    try {
      if (cancelled()) return;
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
      if ((!allowDisabled && !getConfig().examEnabled) || !getConfig().autoSubmit) return;
      // 填答/暂存完成后稍等，给平台同步答案，再重新查找当前提交按钮。
      await skjSleep(500);
      if (!canSubmit()) return;
      const completeBtn = await skjWaitFor(
        () => {
          const btn = document.querySelector('a.completeBtn, .btnSubmit');
          return btn && skjIsDisplayed(btn) ? btn : null;
        },
        { timeout: 3000, interval: 200, cancelled: () => !canSubmit() }
      );
      if (!canSubmit() || !completeBtn) return;
      skjHumanClick(completeBtn);
      const popup = await skjWaitFor(() => this.findVisiblePopup(), { timeout: 8000, interval: 250, cancelled: () => !canSubmit() });
      if (!canSubmit()) return;
      if (!popup) {
        AppState.log('未检测到提交确认弹窗（可能已直接提交）', 'warn');
        return;
      }
      await skjSleep(300);
      if (!canSubmit() || popup.isConnected === false || !skjIsDeepVisible(popup) ||
          this.findVisiblePopup() !== popup) return;
      const content = this.readPopupContent([], popup);
      if (/未做完|未完成|未作答|漏答/.test(content)) {
        this.clickPopupButton([], '#popno, .popno', popup);
        AppState.log('平台提示仍有未作答题目，已取消提交（答案已暂存）', 'warn');
        return;
      }
      if (content.includes('未达到及格线')) {
        this.clickPopupButton([], '#popno, .popno', popup);
        AppState.log('平台提示未达到及格线，已取消提交（答案已暂存）', 'warn');
        return;
      }
      if (canSubmit() && this.clickPopupButton([], '#popok, .popBottom .confirm, .popok', popup)) {
        AppState.log('已自动确认提交作业/考试');
      }
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
