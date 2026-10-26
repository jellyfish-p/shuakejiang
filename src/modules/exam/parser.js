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

/**
 * 严格批请求载荷。选项文字保持原样，label 仅由下标生成（A..Z）。
 * 输入错误在发请求前抛出；旧的纯文本构造/解析函数保持不变。
 */
function buildQuestionBatchPayload(questions, note = '') {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > CX_MAX_BATCH_SIZE) {
    throw new Error(`批请求 questions 必须是包含 1..${CX_MAX_BATCH_SIZE} 题的数组`);
  }
  if (typeof note !== 'string') throw new Error('批请求 note 必须是字符串');

  const ids = new Set();
  const items = Array.from(questions, (question) => {
    if (
      !question || typeof question !== 'object' || Array.isArray(question) ||
      typeof question.id !== 'string' || !question.id.trim() ||
      typeof question.type !== 'string' || typeof question.title !== 'string' ||
      !Array.isArray(question.options) || question.options.length > 26 ||
      Array.from(question.options).some((option) => typeof option !== 'string')
    ) {
      throw new Error('批请求题目必须包含 id/type/title 字符串和 options 字符串数组（最多 26 项）');
    }
    if (ids.has(question.id)) throw new Error(`批请求存在重复 id: ${question.id}`);
    ids.add(question.id);
    return {
      id: question.id,
      type: question.type,
      title: question.title,
      options: question.options.map((text, index) => ({ label: String.fromCharCode(65 + index), text }))
    };
  });
  return note ? { questions: items, note } : { questions: items };
}

/**
 * 只解析完整 JSON（允许外层完整 JSON fence），绝不从散文或数组位置猜答案。
 * 缺失/无效 answer 跳过；结构、未知 id、重复 id 错误使整批失败。
 */
function parseQuestionBatchResponse(rawContent, questions) {
  const byId = new Map(buildQuestionBatchPayload(questions).questions.map((question) => [question.id, question]));
  if (typeof rawContent !== 'string') throw new Error('批量答案必须是 JSON 文本');
  let text = rawContent.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];

  let response;
  try {
    response = JSON.parse(text);
  } catch (e) {
    throw new Error('批量答案不是合法 JSON');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response) || !Array.isArray(response.answers)) {
    throw new Error('批量答案必须是包含 answers 数组的 JSON 对象');
  }

  const answers = new Map();
  const seen = new Set();
  for (const item of response.answers) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !byId.has(item.id)) {
      throw new Error('批量答案包含未知或缺失的 id');
    }
    // 即使第一次出现的 answer 无效，也必须拒绝同一 id 再次出现。
    if (seen.has(item.id)) throw new Error(`批量答案包含重复 id: ${item.id}`);
    seen.add(item.id);
    const answer = normalizeQuestionBatchAnswer(byId.get(item.id), item.answer);
    if (answer !== undefined) answers.set(item.id, answer);
  }
  return answers;
}

/** 严格规范化一个 answer；undefined 表示该题失败，不调用宽松的旧解析器。 */
function normalizeQuestionBatchAnswer(question, answer) {
  if (
    !Array.isArray(answer) || !answer.length ||
    Array.from(answer).some((part) => typeof part !== 'string' || !part.trim())
  ) return undefined;

  const parts = answer.map((part) => part.trim());
  const type = question.type;
  if (type.includes('单选') || type.includes('多选') || type.includes('判断')) {
    const multiple = type.includes('多选');
    if (!multiple && parts.length !== 1) return undefined;
    if (type.includes('判断')) {
      if (/^(正确|true|√)$/i.test(parts[0])) return '正确';
      if (/^(错误|false|×)$/i.test(parts[0])) return '错误';
    }
    // 每一项必须恰好一个字母，拒绝 "答案B"、"A/B"、"AB" 等非协议格式。
    if (parts.some((part) => !/^[A-Za-z]$/.test(part))) return undefined;
    const letters = parts.map((part) => part.toUpperCase());
    if (letters.some((letter) => letter.charCodeAt(0) - 65 >= question.options.length)) return undefined;
    return multiple ? Array.from(new Set(letters)).sort().join('') : letters[0];
  }
  if (type.includes('填空') || type.includes('分录') || type.includes('资料')) return parts;
  // 自由文本不能靠字母正则识别“解释”，只验证字符串结构并保留内容。
  return parts.join('\n');
}
