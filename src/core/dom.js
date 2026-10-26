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
    if (el.disabled || el.isConnected === false) return false;
    // 保留 href：超星部分选项/提交入口通过 javascript: 链接执行站点逻辑。
    // mousedown/up 后只触发一次 click，避免 checkbox 被重复切换。
    ['mousedown', 'mouseup'].forEach((type) => {
      try {
        el.dispatchEvent(
          new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, button: 0 })
        );
      } catch (e) {}
    });
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win, button: 0 }));
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

/** 超星原生 input 与自绘选项共用的选中状态读取。 */
function skjChoiceControl(el) {
  return el.querySelector('input[type="radio"], input[type="checkbox"]') ||
    el.querySelector('[name^=answercheck]') || el.querySelector('[name^=answer]') ||
    el.querySelector('.num_option_dx') || el.querySelector('.num_option') || el.querySelector('input');
}

function skjChoiceSelected(el) {
  const control = skjChoiceControl(el);
  if (control && /^(radio|checkbox)$/i.test(control.type || '')) return !!control.checked;
  return [control, el].filter(Boolean).some(node =>
    node.getAttribute('aria-checked') === 'true' ||
    ['check_answer', 'check_answer_dx', 'is-checked'].some(name => node.classList.contains(name))
  );
}

/** 严格判断词匹配，不能把 false 中的字母或“不正确”当成 true。 */
function skjJudgmentValue(text) {
  const value = String(text == null ? '' : text).trim().replace(/^[（(]?\s*[A-Z](?:\s*[、.，,．。)）:：]\s*|\s+)/i, '').trim();
  if (/^(正确|对|是|√|✓|true|t|yes)$/i.test(value)) return true;
  if (/^(错误|错|否|不正确|×|✗|✘|false|f|no)$/i.test(value)) return false;
  return null;
}

/** 按请求中的选项顺序定位，不依赖 CSS 伪元素里的 A/B；点击后核验完整选中集合。 */
function skjFillChoice(list, questionType, answer, optionTexts = null) {
  if (!list.length || list.some(el => el.isConnected === false)) return false;
  if (optionTexts !== null && (!Array.isArray(optionTexts) || optionTexts.length !== list.length)) return false;
  const multi = questionType.includes('多选');
  const text = String(answer == null ? '' : answer).trim().toUpperCase();
  let indices = [];
  if (questionType.includes('判断') && !/^[A-Z]$/.test(text)) {
    const value = skjJudgmentValue(answer);
    if (value === null) return false;
    // 字体混淆不修改页面：判断题必须使用提取时已还原的选项文字。
    const matches = list.map((el, index) => skjJudgmentValue(optionTexts ? optionTexts[index] : el.innerText) === value ? index : -1).filter(i => i >= 0);
    if (matches.length !== 1) return false;
    indices = matches;
  } else {
    if (!(multi ? /^[A-Z]+$/ : /^[A-Z]$/).test(text)) return false;
    indices = Array.from(new Set(text)).map(letter => letter.charCodeAt(0) - 65);
  }
  if (!indices.length || indices.some(i => i < 0 || i >= list.length)) return false;
  const expected = new Set(indices);
  for (let i = 0; i < list.length; i++) {
    const should = expected.has(i);
    if (skjChoiceSelected(list[i]) === should || (!multi && !should)) continue;
    const control = skjChoiceControl(list[i]);
    if (!skjHumanClick(control || list[i])) return false;
  }
  return list.every((el, i) => skjChoiceSelected(el) === expected.has(i));
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
