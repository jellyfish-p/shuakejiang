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
