const assert = require('assert/strict');
const { runtime } = require('./test-runtime');
const tests = [];
const test = (name, run) => tests.push({ name, run });

function study(r) {
  const studyDoc = r.doc('https://mooc1.chaoxing.com/cards?chapter=1');
  const main = r.node(); main.contentDocument = studyDoc; main.contentWindow = { document: studyDoc };
  main.attrs.src = studyDoc.URL;
  r.document.select('#iframe', main).select('iframe, frame', [main]);
  const media = r.node(); media.ownerDocument = studyDoc;
  Object.assign(media, { duration: 100, currentTime: 0, paused: true, ended: false,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  const taskDoc = r.doc('https://mooc1.chaoxing.com/ananas/modules/video/index.html');
  const frame = r.node(); frame.contentDocument = taskDoc; frame.ownerDocument = studyDoc;
  frame.attrs.src = taskDoc.URL; frame.contentWindow = { document: taskDoc };
  taskDoc.select('video', media).select('video, audio', [media]);
  studyDoc.select('iframe', [frame]).select('iframe, frame', [frame]);
  const va = new r.VideoAssistant(); va.active = true;
  return { va, runner: va.cxRunner, studyDoc, main, frame, media, taskDoc };
}

test('route change is observed while tick is still waiting', async () => {
  const r = runtime(), s = study(r);
  s.taskDoc.select('video', null).select('video, audio', null);
  await s.runner.tick(r.getConfig());
  const pending = s.runner.tick(r.getConfig());
  let settled = false; pending.then(() => { settled = true; });
  await r.advance(100);
  const nextDoc = r.doc('https://mooc1.chaoxing.com/cards?chapter=2');
  s.main.contentDocument = nextDoc; s.main.attrs.src = nextDoc.URL;
  s.runner.tick(r.getConfig()); // real scheduler entry, no manual epoch mutation
  await r.advance(1500);
  assert.equal(settled, true, 'old task must release the single-flight lock after route change');
  assert.equal(s.runner.running, false);
});

test('interrupted config version never restores enabled defaults', () => {
  const r = runtime();
  r.store.set('videoEnabled', false); r.store.set('autoSubmit', false);
  r.store.set('configVersion', 3); // interrupted writer in previous implementation
  assert.equal(r.getConfig().videoEnabled, false);
  assert.equal(r.getConfig().autoSubmit, false);
  r.setConfig({ openaiApiKey: '', openaiModel: 'custom' });
  assert.equal(r.getConfig().autoSubmit, false);
});

test('autoSubmit revoked during save delay prevents submission', async () => {
  const r = runtime(), ea = new r.ExamAssistant();
  const d = r.doc(), submit = r.node(); submit.ownerDocument = d;
  d.select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  const pending = ea.saveCxWork(d, { submit: true });
  await r.advance(600);
  r.setConfig({ autoSubmit: false });
  await r.advance(1200);
  assert.equal(submit.clicks, 0);
  await pending;
});

test('three quiz failures remain blocked across scheduler ticks', async () => {
  const r = runtime(), s = study(r);
  r.setConfig({ openaiApiKey: 'test-only', autoPlay: false });
  let visible = true, calls = 0;
  r.CxDom.isVideoQuizVisible = () => visible;
  s.va.cxSolveVideoQuiz = async () => { calls++; return 'retry'; }; // remote grading boundary
  await s.runner.tick(r.getConfig());
  s.runner.tick(r.getConfig());
  await r.advance(10000);
  for (let i = 0; i < 5; i++) { s.runner.tick(r.getConfig()); await r.advance(2000); }
  assert.equal(calls, 3, 'failed quiz must not restart on next tick');
  visible = false; s.media.ended = true;
  s.runner.tick(r.getConfig()); await r.advance(2000);
  assert.equal(s.runner.index, 1, 'manual resolution should release blocked task');
});

test('fetch fallback settles on deadline even without AbortController', async () => {
  const r = runtime(); r.sandbox.AbortController = undefined;
  r.sandbox.fetch = () => new Promise(() => {});
  let result;
  r.requestOpenAI('test', null, { openaiApiKey: 'test-only' }).catch(e => { result = e.message; });
  await r.advance(46000);
  assert.match(result || '', /超时/);
});

test('same-origin stranger cannot trigger cross-frame navigation', () => {
  const r = runtime(), va = new r.VideoAssistant();
  assert.equal(va.isTrustedMediaMessage({ source: {}, origin: 'https://mooc1.chaoxing.com' }), false);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.run(); console.log('✅ ' + t.name); }
    catch (e) { failed++; console.error('❌ ' + t.name + ': ' + e.message); }
  }
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
