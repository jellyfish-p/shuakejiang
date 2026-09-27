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
    const isComplete = this.videoAssist?.isChapterQuizComplete(targetDoc) ?? (
      targetDoc.querySelector('.testTit_status, .ceyan_status')?.classList?.contains('testTit_status_complete') ||
      targetDoc.body?.innerText?.includes('待批阅') ||
      targetDoc.querySelector('.Zy_sub')?.innerText?.includes('已完成')
    );

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
