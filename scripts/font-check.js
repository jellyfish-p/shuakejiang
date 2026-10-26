const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { runtime } = require('./test-runtime');
const tests = [];
const test = (name, run) => tests.push({ name, run });

// Minimal real tree semantics, plus the existing deterministic runtime's selector/click fixtures.
function fixture(r = runtime(), raw = '甲乙', fontData = 'A') {
  const d = r.doc(), canvases = [], fontSet = new Set();
  function el(tag = 'span', text = '', secret = false) {
    const n = r.node();
    Object.assign(n, { nodeName: tag.toUpperCase(), ownerDocument: d, childNodes: [], secret });
    n.classList = { contains: name => name === 'font-cxsecret' && n.secret };
    n.closest = selector => {
      for (let p = n; p; p = p.parentElement) if (selector === '.font-cxsecret' && p.secret) return p;
      return null;
    };
    n.contains = target => n === target || n.childNodes.some(c => c === target || c.contains?.(target));
    n.append = child => { child.parentElement = n; n.childNodes.push(child); return child; };
    Object.defineProperty(n, 'innerText', { configurable: true, get: () => n.childNodes.map(c => c.nodeType === 3 ? c.nodeValue : c.innerText).join('') });
    Object.defineProperty(n, 'textContent', { configurable: true, get: () => n.innerText });
    if (text) n.append({ nodeType: 3, nodeValue: text, ownerDocument: d, isConnected: true });
    return n;
  }
  const root = el('div'), encoded = root.append(el('span', raw, true));
  const style = { textContent: `@font-face {font-family: 'font-cxsecret';src:url("data:font/ttf;base64,${Buffer.from(fontData).toString('base64')}")} .font-cxsecret {font-family:'font-cxsecret'}` };
  d.select('style', [style]);
  r.win.atob = value => Buffer.from(value, 'base64').toString('binary');
  r.win.getComputedStyle = n => ({ display: n.display || 'inline', visibility: 'visible', opacity: '1',
    fontFamily: n.fontFamily || (n.closest?.('.font-cxsecret') ? '"font-cxsecret", sans-serif' : 'sans-serif') });
  r.win.FontFace = class {
    constructor(family, bytes) { this.family = family; this.bytes = bytes; }
    load() { return Promise.resolve(this); }
  };
  d.fonts = { add: face => fontSet.add(face), delete: face => fontSet.delete(face) };
  d.createElement = tag => {
    assert.equal(tag, 'canvas');
    const draws = [], ctx = { fillRect() {}, fillText(text) { draws.push(text); } };
    const canvas = { width: 0, height: 0, draws, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=' };
    canvases.push(canvas); return canvas;
  };
  return { r, d, root, encoded, style, el, canvases, fontSet };
}

// Unit adapter: known synthetic outlines isolate the strategy, not a production font/table assumption.
function unit(f, overrides = {}) {
  const paths = [{ cmds: ['M', 'L'], crds: [0, 0, 1, 1] }, { cmds: ['M', 'L'], crds: [2, 2, 3, 3] }];
  const md5 = text => crypto.createHash('md5').update(text).digest('hex');
  const table = Object.fromEntries(paths.map((p, i) => [md5(JSON.stringify(p)).slice(24), '中文'.codePointAt(i)]));
  const calls = [];
  const sessionData = overrides.sessionData || new Map();
  const sessionStorage = {
    getItem: key => sessionData.has(key) ? sessionData.get(key) : null,
    setItem: (key, value) => sessionData.set(key, String(value)),
    removeItem: key => sessionData.delete(key)
  };
  f.r.win.sessionStorage = sessionStorage;
  const sandbox = vm.createContext({
    Uint8Array, setTimeout, clearTimeout, sessionStorage,
    CX_FONT_LIB: { md5, Typr: {
      parse: bytes => [{ cmap: {}, alternate: bytes[0] === 66 }],
      U: { codeToGlyph: (font, cp) => cp === 0x7532 ? (font.alternate ? 2 : 1) : cp === 0x4e59 ? 2 : cp === 0x4e19 ? 3 : 0,
        glyphToPath: (_, glyph) => paths[glyph - 1] || { cmds: ['M'], crds: [99, 99] } }
    } },
    CX_FONT_TABLE: table,
    resolveCxVisionConfig: config => config,
    requestCxGlyphRecognition: async (image, ids) => { calls.push({ image, ids }); return new Map(ids.map(id => [id, '中'])); },
    ...overrides
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/modules/chaoxing/cxFont.js'), 'utf8') + '\nglobalThis.font = CxFont;', sandbox);
  return { font: sandbox.font, calls, sandbox, sessionData };
}

const compact = text => text.replace(/\s+/g, '');

test('table strategy decodes only marked text, preserves DOM and handles nested markup', async () => {
  const f = fixture();
  const ordinary = f.root.append(f.el('span', '甲'));
  f.encoded.append(f.el('b', '乙'));
  const { font, calls } = unit(f);
  const reader = await font.prepare([f.root], { cxFontStrategy: 'table' });
  assert.equal(compact(reader.readText(f.root)), '中文文甲');
  assert.equal(reader.readText(ordinary), '甲');
  assert.equal(f.encoded.innerText, '甲乙乙');
  assert.equal(f.encoded.secret, true);
  assert.equal(reader.characters, 2);
  assert.equal(calls.length, 0);
});

test('characters absent from cmap remain unchanged, while table misses fail closed', async () => {
  const f = fixture(undefined, '甲天，A');
  const { font } = unit(f);
  const reader = await font.prepare([f.root], {});
  assert.equal(compact(reader.readText(f.root)), '中天，A');
  f.encoded.childNodes[0].nodeValue = '丙';
  await assert.rejects(font.prepare([f.root], {}), /未命中/);
  assert.equal(f.encoded.innerText, '丙');
});

test('same named fonts in different iframe documents do not share mappings', async () => {
  const r = runtime(), a = fixture(r, '甲', 'A'), b = fixture(r, '甲', 'B');
  const { font } = unit(a);
  const reader = await font.prepare([a.root, b.root], {});
  assert.equal(compact(reader.readText(a.root)), '中');
  assert.equal(compact(reader.readText(b.root)), '文');
});

test('missing/external/ambiguous font sources reject rather than send raw obfuscated text', async () => {
  const f = fixture(), { font } = unit(f);
  f.style.textContent = '.font-cxsecret { font-family:font-cxsecret }';
  await assert.rejects(font.prepare([f.root], {}), /Base64/);
  f.style.textContent = '@font-face {font-family:font-cxsecret;src:url("https://example.invalid/font.ttf")}';
  await assert.rejects(font.prepare([f.root], {}), /Base64/);
  f.style.textContent = "@font-face {font-family:font-cxsecret;src:url('data:font/ttf;base64,QQ==')} @font-face {font-family:font-cxsecret;src:url('data:font/ttf;base64,Qg==')}";
  await assert.rejects(font.prepare([f.root], {}), /多份/);
});

test('double and single quoted data URLs work and stale nodes/styles are rejected', async () => {
  const f = fixture(), { font } = unit(f);
  f.style.textContent = f.style.textContent.replaceAll('"', "'");
  const reader = await font.prepare([f.root], {});
  f.encoded.childNodes[0].nodeValue = '乙甲';
  assert.throws(() => reader.readText(f.root), /变化/);
  f.encoded.childNodes[0].nodeValue = '甲乙';
  f.style.textContent += '\n/* font changed */';
  assert.throws(reader.assertCurrent, /变化/);
});

test('style-only markers and hidden text do not invoke any decoder', async () => {
  const f = fixture(undefined, '丙'); f.encoded.display = 'none';
  const { font, calls } = unit(f);
  const reader = await font.prepare([f.root], { cxFontStrategy: 'vision' });
  assert.equal(reader.characters, 0);
  assert.equal(calls.length, 0);
  assert.equal(f.fontSet.size, 0);
});

test('vision generates numbered glyph-only grids, splits at forty, and releases fonts', async () => {
  const chars = Array.from({ length: 41 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
  const f = fixture(undefined, chars), { font, calls } = unit(f);
  const reader = await font.prepare([f.root], { cxFontStrategy: 'vision' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.ids.length), [40, 1]);
  assert.equal(f.canvases[0].draws[0], 'g1');
  assert.equal(f.canvases[0].draws[1], chars[0]);
  assert.equal(compact(reader.readText(f.root)), '中'.repeat(41));
  assert.equal(f.encoded.innerText, chars);
  assert.equal(f.fontSet.size, 0);
});

test('vision decoding reuses valid results from sessionStorage across page instances', async () => {
  const config = {
    cxFontStrategy: 'vision', openaiBaseUrl: 'https://vision.example.invalid/v1',
    openaiApiKey: 'session-only-api-key', openaiModel: 'vision-model'
  };
  const first = fixture(undefined, '甲乙', 'same-font');
  const one = unit(first);
  const reader = await one.font.prepare([first.root], config);
  assert.equal(one.calls.length, 1);
  assert.equal(compact(reader.readText(first.root)), '中中');
  assert.equal(one.sessionData.size, 1);
  assert.ok(!JSON.stringify(Array.from(one.sessionData)).includes(config.openaiApiKey), 'cache must not store the API key');

  const second = fixture(undefined, '甲乙', 'same-font');
  const two = unit(second, { sessionData: one.sessionData });
  second.r.win.FontFace = undefined;
  const cached = await two.font.prepare([second.root], config);
  assert.equal(two.calls.length, 0, 'same font/config must reuse the session result');
  assert.equal(compact(cached.readText(second.root)), '中中');

  const changedConfig = { ...config, openaiModel: 'different-vision-model' };
  second.r.win.FontFace = class { load() { return Promise.resolve(this); } };
  await two.font.prepare([second.root], changedConfig);
  assert.equal(two.calls.length, 1, 'changing visual API config must use a separate cache entry');
});

test('cancellation during vision prevents later uploads and ignores late results', async () => {
  let cancelled = false, calls = 0;
  const f = fixture(undefined, Array.from({ length: 41 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(''));
  const { font } = unit(f, { requestCxGlyphRecognition: async (_, ids) => {
    calls++; cancelled = true; return new Map(ids.map(id => [id, '中']));
  } });
  await assert.rejects(font.prepare([f.root], { cxFontStrategy: 'vision' }, { cancelled: () => cancelled }), /取消/);
  assert.equal(calls, 1); assert.equal(f.fontSet.size, 0);
});

test('changed DOM during recognition rejects the entire reader', async () => {
  const f = fixture();
  const { font } = unit(f, { requestCxGlyphRecognition: async (_, ids) => {
    f.encoded.childNodes[0].nodeValue = '新的题目';
    return new Map(ids.map(id => [id, '中']));
  } });
  await assert.rejects(font.prepare([f.root], { cxFontStrategy: 'vision' }), /变化/);
  assert.equal(f.fontSet.size, 0);
});

function questionFixture(r, type = '0') {
  const f = fixture(r), q = f.root, inputType = r.node(); inputType.value = type;
  const options = [f.el('span', '乙', true), f.el('span', '甲', true)];
  for (const option of options) {
    q.append(option);
    const input = r.node(); input.type = 'radio'; input.checked = false;
    option.select('input[type="radio"], input[type="checkbox"]', input);
    input.addEventListener('click', () => { options.forEach(o => { o.input.checked = false; }); input.checked = true; });
    option.input = input;
  }
  q.select('input[id^="answertype"]', inputType).select('.Zy_TItle', f.encoded)
    .select('.before-after', options).select('.before-after, .before-after-checkbox', options)
    .select('.mark_name .qtContent, h3, .Zy_TItle', f.encoded).select('.answerBg', options);
  f.d.select('#ZyBottom .singleQuesId', [q]);
  return { ...f, options };
}

function api(r, options = {}) {
  const calls = [];
  r.sandbox.fetch = async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    let content;
    if (Array.isArray(body.messages[1].content)) {
      options.onVision?.();
      content = JSON.stringify({ characters: options.incomplete ? [{ id: 'g1', text: '中' }] : [{ id: 'g1', text: '中' }, { id: 'g2', text: '文' }] });
    } else {
      options.onAnswer?.();
      const payload = JSON.parse(body.messages[1].content);
      content = JSON.stringify({ answers: payload.questions.map(q => ({ id: q.id, answer: ['B'] })) });
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return calls;
}

test('chapter integration recognizes first, sends decoded text JSON, then fills and submits', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(), saves = [];
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only', autoSubmit: true });
  ea.saveCxWork = async (_, { submit }) => { saves.push(submit); return submit ? 'submitted' : 'saved'; };
  const calls = api(r);
  const result = await ea.runCxWorkDoc(f.d, r.getConfig());
  assert.equal(calls.length, 2);
  const question = JSON.parse(calls[1].body.messages[1].content).questions[0];
  assert.equal(compact(question.title), '中文');
  assert.deepEqual(question.options.map(o => o.text), ['文', '中']);
  assert.equal(f.options[1].input.checked, true);
  assert.equal(f.encoded.innerText, '甲乙');
  assert.deepEqual(saves, [true]); assert.equal(result.submitSafe, true);
});

test('partial vision output blocks the answer API and automatic submission', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(), saves = [];
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only', autoSubmit: true });
  ea.saveCxWork = async (_, { submit }) => { saves.push(submit); return 'saved'; };
  const calls = api(r, { incomplete: true });
  const result = await ea.runCxWorkDoc(f.d, r.getConfig());
  assert.equal(calls.length, 1); assert.deepEqual(saves, [false]); assert.equal(result.submitSafe, false);
  assert.ok(f.options.every(o => !o.input.checked));
});

test('switching strategy during an image request cancels late answers and save/submit', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(); let saves = 0;
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only', autoSubmit: true });
  ea.saveCxWork = async () => { saves++; return 'submitted'; };
  const calls = api(r, { onVision: () => r.setConfig({ cxFontStrategy: 'table' }) });
  const result = await ea.runCxWorkDoc(f.d, r.getConfig());
  assert.equal(result.reason, 'cancelled'); assert.equal(calls.length, 1); assert.equal(saves, 0);
});

test('changed obfuscated text during answer request never fills or submits stale answers', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(), saves = [];
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only', autoSubmit: true });
  ea.saveCxWork = async (_, { submit }) => { saves.push(submit); return 'saved'; };
  api(r, { onAnswer: () => { f.encoded.childNodes[0].nodeValue = '乙甲'; } });
  await ea.runCxWorkDoc(f.d, r.getConfig());
  assert.ok(f.options.every(o => !o.input.checked)); assert.deepEqual(saves, [false]);
});

test('independent questionLi page uses the same font protection and decoded options', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(); let failed;
  r.document.select('.questionLi', [f.root]);
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only', autoSubmit: false });
  ea.saveQuestionLiPage = async (_, count) => { failed = count; };
  const calls = api(r);
  await ea.solveChaoxingQuestionLiPage(r.getConfig());
  assert.equal(failed, 0); assert.equal(f.options[1].input.checked, true);
  assert.deepEqual(JSON.parse(calls[1].body.messages[1].content).questions[0].options.map(o => o.text), ['文', '中']);
});

test('judgment filling uses decoded option text without mutating displayed glyphs', () => {
  const r = runtime(), f = questionFixture(r, '3'), ea = new r.ExamAssistant();
  assert.equal(ea.fillCxQuestion(f.root, '判断题', '错误', f.options, ['正确', '错误']), true);
  assert.equal(f.options[1].input.checked, true);
  assert.equal(f.options[1].innerText, '甲');
});

test('FontFace timeout rejects and cleans up without sending an image', async () => {
  const r = runtime(), f = fixture(r); let calls = 0;
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only' });
  r.win.FontFace = class { load() { return new Promise(() => {}); } };
  r.sandbox.fetch = async () => { calls++; throw new Error('must not upload'); };
  const pending = assert.rejects(r.CxFont.prepare([f.root], r.getConfig()), /字体加载超时/);
  await r.advance(16000); await pending;
  assert.equal(calls, 0); assert.equal(f.fontSet.size, 0);
});

test('video quiz applies the same font reader before its single-question answer request', async () => {
  const r = runtime(), f = questionFixture(r), va = new r.VideoAssistant(), frame = r.node();
  const submit = r.node(), next = r.node();
  submit.ownerDocument = next.ownerDocument = f.d; frame.contentDocument = f.d;
  f.d.select('.ans-videoquiz', f.root).select('.tkTopic_title', f.el('span', '单选题'))
    .select('.ans-videoquiz .tkTopic', f.encoded).select('.ans-videoquiz-opt', f.options)
    .select('#videoquiz-submit', submit);
  submit.addEventListener('click', () => f.d.select('#videoquiz-continue', next));
  r.setConfig({ cxFontStrategy: 'vision', openaiApiKey: 'test-only' });
  const calls = api(r);
  const pending = va.cxSolveVideoQuiz(frame, r.getConfig()); await r.advance(6000);
  assert.equal(await pending, 'resolved'); assert.equal(calls.length, 2);
  assert.equal(compact(JSON.parse(calls[1].body.messages[1].content).questions[0].title), '中文');
  assert.equal(f.options[1].input.checked, true); assert.equal(submit.clicks, 1);
});

test('table-mode parse failure in a chapter never falls back to a vision request', async () => {
  const r = runtime(), f = questionFixture(r), ea = new r.ExamAssistant(), saves = [];
  r.setConfig({ cxFontStrategy: 'table', openaiApiKey: 'test-only', autoSubmit: true });
  ea.saveCxWork = async (_, { submit }) => { saves.push(submit); return 'saved'; };
  const calls = api(r);
  await ea.runCxWorkDoc(f.d, r.getConfig());
  assert.equal(calls.length, 0); assert.deepEqual(saves, [false]);
});

test('vendored MD5 and table keep the pinned upstream data available offline', () => {
  const r = runtime();
  assert.equal(r.CX_FONT_LIB.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(r.CX_FONT_TABLE.version, '20220515.1');
  assert.equal(r.CX_FONT_TABLE.license, 'MIT');
  assert.equal(Object.values(r.CX_FONT_TABLE).filter(Number.isInteger).length, 20902);
});

(async () => {
  for (const { name, run } of tests) {
    try { await run(); console.log('✅ ' + name); }
    catch (error) { console.error('❌ ' + name); throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
