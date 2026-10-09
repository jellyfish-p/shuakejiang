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
    try {
      el.removeAttribute('href');
    } catch (e) {}
    ['mousedown', 'mouseup', 'click'].forEach((type) => {
      try {
        el.dispatchEvent(
          new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, button: 0 })
        );
      } catch (e) {}
    });
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
