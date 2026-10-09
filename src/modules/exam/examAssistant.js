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
