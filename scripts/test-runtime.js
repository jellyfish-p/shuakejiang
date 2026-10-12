// Deterministic browser boundary for tests: no network, real time, or platform account.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runtime() {
  let now = 100000, id = 0;
  const timers = new Map(), store = new Map(), events = new Map();
  const set = (fn, delay, repeat = false) => {
    const key = ++id;
    timers.set(key, { fn, at: now + Math.max(1, Number(delay) || 0), repeat, delay });
    return key;
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const location = { href: 'https://mooc1.chaoxing.com/mycourse/studentstudy', hostname: 'mooc1.chaoxing.com' };
  const win = {
    location, _skj_media_hooked: true,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    MouseEvent: class { constructor(type, props) { Object.assign(this, props, { type }); } },
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); }
  };
  win.self = win.top = win;
  function node(text = '') {
    const selectors = new Map(), listeners = new Map();
    const n = {
      nodeType: 1, innerText: text, textContent: text, dataset: {}, isConnected: true,
      ownerDocument: null, clicks: 0, attrs: {}, classList: { contains: () => false },
      querySelector: (s) => selectors.get(s) || null,
      querySelectorAll: (s) => { const v = selectors.get(s); return v ? (Array.isArray(v) ? v : [v]) : []; },
      getElementById: (s) => selectors.get('#' + s) || null,
      getElementsByTagName: (s) => n.querySelectorAll(s),
      getBoundingClientRect: () => ({ width: 120, height: 60 }), scrollIntoView() {},
      getAttribute: (k) => n.attrs[k] || null,
      setAttribute: (k, v) => { n.attrs[k] = v; }, removeAttribute: (k) => { delete n.attrs[k]; },
      addEventListener: (name, fn) => { listeners.set(name, [...(listeners.get(name) || []), fn]); },
      dispatchEvent(e) { if (e.type === 'click') n.clicks++; for (const fn of listeners.get(e.type) || []) fn(e); },
      closest: () => null,
      select(s, v) { selectors.set(s, v); return n; }
    };
    return n;
  }
  function doc(url = location.href) {
    const d = node();
    Object.assign(d, { nodeType: 9, URL: url, title: '', readyState: 'complete', visibilityState: 'visible', defaultView: win });
    d.documentElement = node(); d.body = node();
    d.documentElement.ownerDocument = d.body.ownerDocument = d;
    return d;
  }
  const document = doc();
  win.document = document;
  const sandbox = vm.createContext({ window: win, document, location, URL, AbortController,
    Date: ClockDate, console: { log() {}, warn() {}, error() {} },
    setTimeout: (f, d) => set(f, d), clearTimeout: (t) => timers.delete(t),
    setInterval: (f, d) => set(f, d, true), clearInterval: (t) => timers.delete(t),
    GM_getValue: (k, def) => store.has(k) ? store.get(k) : def,
    GM_setValue: (k, v) => store.set(k, structuredClone(v)),
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ json: async () => ({ choices: [{ message: { content: 'A' } }] }) })
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'shuakejiang.user.js'), 'utf8');
  const code = source.replace(/\n\s*main\(\);\s*\n\}\)\(\);\s*$/, `
    globalThis.api = { CxCourseRunner, CxDom, Site, ExamAssistant, VideoAssistant, UIController,
      AppState, Storage, getConfig, setConfig, requestOpenAI, skjWaitFor, skjWithTimeout };
  })();`);
  if (code === source) throw new Error('Runtime export seam missing');
  vm.runInContext(code, sandbox);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    await flush();
    let iterations = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      if (++iterations > 20000) throw new Error('Runaway timer loop');
      now = next[1].at; timers.delete(next[0]);
      if (next[1].repeat) timers.set(next[0], { ...next[1], at: now + next[1].delay });
      next[1].fn();
      await flush();
    }
    now = end; await flush();
  }
  return { ...sandbox.api, sandbox, store, timers, win, location, document, node, doc, flush, advance,
    message: (event) => { for (const fn of events.get('message') || []) fn(event); } };
}
module.exports = { runtime };
