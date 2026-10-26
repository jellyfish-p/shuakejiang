const assert = require('assert/strict');
const { runtime } = require('./test-runtime');
const tests = [];
const test = (name, run) => tests.push({ name, run });

// Browser-boundary fixtures: labels can live in attributes/icons rather than visible text.
function choice(r, text, selected = false) {
  const el = r.node(text), input = r.node();
  el.ownerDocument = input.ownerDocument = r.document;
  input.type = 'radio'; input.checked = selected;
  input.classList = { contains: () => false };
  el.select('[name^=answer]', input).select('input', input)
    .select('input[type="radio"], input[type="checkbox"]', input);
  // Clicking an option activates the site's choice handler. A non-clickable fixture
  // deliberately has no handler, to catch success being reported without a selection.
  el.addEventListener('click', () => { input.checked = true; });
  input.addEventListener('click', () => { input.checked = true; });
  return { el, input };
}

function chapter(r, count) {
  const d = r.doc(), choices = [], questions = [];
  for (let i = 0; i < count; i++) {
    const q = r.node(), type = r.node(); type.value = '0';
    const opts = [choice(r, 'A. 甲'), choice(r, 'B. 乙')];
    q.ownerDocument = d;
    q.select('input[id^="answertype"]', type).select('.Zy_TItle', r.node(`测试题 ${i + 1}`))
      .select('.before-after', opts.map(o => o.el))
      .select('.before-after, .before-after-checkbox', opts.map(o => o.el));
    choices.push(opts); questions.push(q);
  }
  d.select('#ZyBottom .singleQuesId', questions);
  r.setConfig({ openaiApiKey: 'test-only', autoSubmit: false, solveInterval: 800 });
  return { d, choices, questions };
}

function mockBatchAPI(r, reply) {
  const requests = [];
  r.sandbox.fetch = async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    let payload;
    try { payload = JSON.parse(body.messages[1].content); } catch (_) {}
    const content = payload?.questions
      ? JSON.stringify(reply(payload.questions)) : 'B';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return requests;
}

test('chapter batches 9 questions as 4/4/1 and maps shuffled JSON answers by id', async () => {
  const r = runtime(), s = chapter(r, 9), ea = new r.ExamAssistant();
  const requests = mockBatchAPI(r, qs => ({ answers: qs.map(q => ({ id: q.id, answer: ['B'] })).reverse() }));
  const pending = ea.runCxWorkDoc(s.d, r.getConfig());
  await r.advance(30000);
  const result = await pending;
  assert.equal(requests.length, 3, 'nine questions must use exactly three requests');
  assert.deepEqual(requests.map(b => JSON.parse(b.messages[1].content).questions.length), [4, 4, 1]);
  assert.ok(requests.every(b => b.response_format?.type === 'json_object'));
  assert.ok(s.choices.every(opts => opts[1].input.checked));
  assert.equal(result.submitSafe, false);
});

test('chapter single choice selects by option order when letters are not in innerText', async () => {
  const r = runtime(), ea = new r.ExamAssistant(), q = r.node();
  const opts = [choice(r, '甲'), choice(r, '乙')];
  const filled = await ea.fillCxQuestion(q, '单选题', 'B', opts.map(o => o.el));
  assert.equal(filled, true);
  assert.equal(opts[1].input.checked, true, 'the requested choice must actually be selected');
});

test('judgment false matches × instead of falling back to the first option', async () => {
  const r = runtime(), ea = new r.ExamAssistant(), q = r.node();
  const opts = [choice(r, '√'), choice(r, '×')];
  const filled = await ea.fillCxQuestion(q, '判断题', '错误', opts.map(o => o.el));
  assert.equal(filled, true);
  assert.equal(opts[1].input.checked, true);
  assert.equal(opts[0].input.checked, false);
});

test('a click with no selected-state change must not count as a completed answer', async () => {
  const r = runtime(), ea = new r.ExamAssistant(), q = r.node();
  const el = r.node('A. 甲'), input = r.node(); input.type = 'radio'; input.checked = false;
  el.select('[name^=answer]', input).select('input', input)
    .select('input[type="radio"], input[type="checkbox"]', input);
  assert.equal(await ea.fillCxQuestion(q, '单选题', 'A', [el]), false);
});

test('submission click preserves javascript href used by Chaoxing action links', async () => {
  const r = runtime(), ea = new r.ExamAssistant(), d = r.doc(), submit = r.node();
  submit.ownerDocument = d; submit.attrs.href = 'javascript:submitCheck();';
  submit.click = () => {
    submit.clicks++;
    if (submit.attrs.href === 'javascript:submitCheck();') d.select('.testTit_status, .ceyan_status', r.node('已提交'));
  };
  d.select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  const pending = ea.saveCxWork(d, { submit: true });
  await r.advance(30000);
  assert.equal(await pending, 'submitted');
  assert.equal(submit.clicks, 1);
  assert.equal(submit.attrs.href, 'javascript:submitCheck();', 'do not remove the platform submit handler');
});

function submission(r, d) {
  const save = r.node(), submit = r.node(), popup = r.node('确认提交？'), confirm = r.node();
  for (const n of [save, submit, popup, confirm]) n.ownerDocument = d;
  d.select('.btnSave.workBtnIndex, .ZY_sub .btnSave, .btnSave', save)
    .select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  submit.addEventListener('click', () => d.select('#workpop', popup));
  popup.select('#popok, .popok', confirm);
  confirm.addEventListener('click', () => {
    d.select('#workpop', null).select('.testTit_status, .ceyan_status', r.node('已提交'));
  });
  return { save, submit, popup, confirm };
}

test('valid batch fills all choices before saving and confirming submission', async () => {
  const r = runtime(), s = chapter(r, 5), ui = submission(r, s.d), ea = new r.ExamAssistant();
  r.setConfig({ autoSubmit: true });
  mockBatchAPI(r, qs => ({ answers: qs.map(q => ({ id: q.id, answer: ['B'] })) }));
  ui.save.addEventListener('click', () => assert.ok(s.choices.every(opts => opts[1].input.checked)));
  const pending = ea.runCxWorkDoc(s.d, r.getConfig());
  await r.advance(30000);
  const result = await pending;
  assert.equal(ui.submit.clicks, 1); assert.equal(ui.confirm.clicks, 1);
  assert.equal(result.reason, 'submitted'); assert.equal(result.submitSafe, true);
});

test('missing answer blocks submit while retaining valid answers for review', async () => {
  const r = runtime(), s = chapter(r, 3), ui = submission(r, s.d), ea = new r.ExamAssistant();
  r.setConfig({ autoSubmit: true });
  mockBatchAPI(r, qs => ({ answers: [{ id: qs[0].id, answer: ['B'] }] }));
  const pending = ea.runCxWorkDoc(s.d, r.getConfig()); await r.advance(30000);
  const result = await pending;
  assert.equal(s.choices[0][1].input.checked, true);
  assert.equal(s.choices[1][1].input.checked, false);
  assert.equal(ui.save.clicks, 1); assert.equal(ui.submit.clicks, 0);
  assert.match(result.reason, /2题未完成/);
});

for (const kind of ['duplicate', 'unknown', 'invalid-choice', 'invalid-type', 'non-json']) {
  test(`${kind} response never causes automatic submission`, async () => {
    const r = runtime(), s = chapter(r, 2), ui = submission(r, s.d), ea = new r.ExamAssistant();
    r.setConfig({ autoSubmit: true });
    mockBatchAPI(r, qs => {
      if (kind === 'non-json') return '答案是 B';
      const answer = kind === 'invalid-choice' ? ['Z'] : kind === 'invalid-type' ? 'B' : ['B'];
      return { answers: qs.map((q, i) => ({
        id: kind === 'duplicate' ? qs[0].id : kind === 'unknown' && i === 1 ? 'q99' : q.id, answer
      })) };
    });
    const pending = ea.runCxWorkDoc(s.d, r.getConfig()); await r.advance(30000); await pending;
    assert.equal(ui.submit.clicks, 0);
    assert.ok(s.choices.every(opts => !opts[0].input.checked && !opts[1].input.checked));
  });
}

test('disabling exam during a batch prevents late answers and all submit actions', async () => {
  const r = runtime(), s = chapter(r, 5), ui = submission(r, s.d), ea = new r.ExamAssistant();
  let resolve, calls = 0;
  r.sandbox.fetch = (_, options) => {
    calls++; const qs = JSON.parse(JSON.parse(options.body).messages[1].content).questions;
    return new Promise(done => { resolve = () => done({ ok: true, json: async () => ({ choices: [{ message: {
      content: JSON.stringify({ answers: qs.map(q => ({ id: q.id, answer: ['B'] })) })
    } }] }) }); });
  };
  const pending = ea.runCxWorkDoc(s.d, r.getConfig()); await r.flush();
  r.setConfig({ examEnabled: false }); resolve(); await r.advance(30000);
  assert.equal((await pending).reason, 'cancelled');
  assert.equal(calls, 1); assert.equal(ui.save.clicks, 0); assert.equal(ui.submit.clicks, 0);
  assert.ok(s.choices.every(opts => !opts[1].input.checked));
});

test('revoking auto-submit while waiting for a popup prevents confirmation', async () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = submission(r, d);
  // Delayed popup, as on a network-backed confirmation flow.
  const submit = r.node(); submit.ownerDocument = d;
  d.select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  submit.addEventListener('click', () => {
    r.sandbox.setTimeout(() => d.select('#workpop', ui.popup), 800);
  });
  const pending = ea.saveCxWork(d, { submit: true }); await r.advance(1400);
  r.setConfig({ autoSubmit: false }); await r.advance(30000);
  assert.equal(await pending, 'cancelled'); assert.equal(ui.confirm.clicks, 0);
});

test('multiple choice deselects stale choices synchronously and checks every target', async () => {
  const r = runtime(), ea = new r.ExamAssistant(), opts = ['甲', '乙', '丙'].map(text => choice(r, text));
  for (const { el, input } of opts) {
    input.type = 'checkbox';
    input.click = () => { input.checked = !input.checked; input.clicks++; };
  }
  opts[0].input.checked = true;
  assert.equal(ea.fillCxQuestion(r.node(), '多选题', 'BC', opts.map(o => o.el)), true);
  assert.deepEqual(opts.map(o => o.input.checked), [false, true, true]);
  assert.equal(ea.fillCxQuestion(r.node(), '多选题', 'BZ', opts.map(o => o.el)), false);
  assert.deepEqual(opts.map(o => o.input.checked), [false, true, true]);
});

test('blank answers preserve JSON arrays and reject a missing blank', () => {
  const r = runtime(), ea = new r.ExamAssistant(), q = r.node();
  const blanks = [r.node(), r.node()], inputs = [r.node(), r.node()];
  blanks.forEach((blank, i) => blank.select('textarea', inputs[i]));
  q.select('.blankItemDiv', blanks);
  assert.equal(ea.fillCxQuestion(q, '填空题', ['C#', '第二空'], []), true);
  assert.deepEqual(inputs.map(i => i.value), ['C#', '第二空']);
  assert.equal(ea.fillCxQuestion(q, '填空题', ['不应重复'], []), false);
  assert.deepEqual(inputs.map(i => i.value), ['C#', '第二空']);
});

test('questionLi page uses the same four-question batches and no deferred choice clicks', async () => {
  const r = runtime(), s = chapter(r, 5), ea = new r.ExamAssistant();
  s.questions.forEach((q, i) => {
    q.select('.mark_name .colorShallow, h3, .Zy_TItle', r.node('单选题'))
      .select('.mark_name .qtContent, h3, .Zy_TItle', r.node(`作业 ${i + 1}`))
      .select('.answerBg', s.choices[i].map(o => o.el));
  });
  r.document.select('.questionLi', s.questions);
  const requests = mockBatchAPI(r, qs => ({ answers: qs.map(q => ({ id: q.id, answer: ['B'] })) }));
  const pending = ea.solveChaoxingQuestionLiPage(r.getConfig()); await r.advance(30000);
  assert.equal(await pending, true);
  assert.deepEqual(requests.map(b => JSON.parse(b.messages[1].content).questions.length), [4, 1]);
  assert.ok(s.choices.every(opts => opts[1].input.checked));
});

test('JSON batch supports mixed types, fenced JSON, lowercase choices and literal false', async () => {
  const r = runtime(); r.setConfig({ openaiApiKey: 'test-only' });
  let body;
  r.sandbox.fetch = async (_, options) => {
    body = JSON.parse(options.body);
    const answers = [
      { id: 'single', answer: ['b'] }, { id: 'multi', answer: ['c', 'a', 'c'] },
      { id: 'judge', answer: ['false'] }, { id: 'blank', answer: ['C#', '第二空'] }
    ];
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify({ answers }) + '\n```' } }] }) };
  };
  const questions = [
    { id: 'single', type: '单选题' }, { id: 'multi', type: '多选题' },
    { id: 'judge', type: '判断题' }, { id: 'blank', type: '填空题' }
  ].map(q => ({ ...q, title: '测试', options: ['甲', '乙', '丙'] }));
  const answers = await r.requestQuestionBatch(questions, r.getConfig());
  assert.equal(answers.get('single'), 'B'); assert.equal(answers.get('multi'), 'AC');
  assert.equal(answers.get('judge'), '错误');
  assert.deepEqual(Array.from(answers.get('blank')), ['C#', '第二空']);
  assert.deepEqual(JSON.parse(body.messages[1].content).questions[0].options, [
    { label: 'A', text: '甲' }, { label: 'B', text: '乙' }, { label: 'C', text: '丙' }
  ]);
});

test('batch entry rejects more than four questions before contacting the API', async () => {
  const r = runtime(); let calls = 0;
  r.sandbox.fetch = () => { calls++; throw new Error('must not request'); };
  const questions = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, type: '单选题', title: '测试', options: ['甲'] }));
  await assert.rejects(r.requestQuestionBatch(questions, r.getConfig()), /1\.\.4/);
  assert.equal(calls, 0);
});

test('GM transport sends JSON mode and preserves judgment option order', async () => {
  const r = runtime(); let body;
  r.setConfig({ openaiApiKey: 'test-only' });
  r.sandbox.GM_xmlhttpRequest = options => {
    body = JSON.parse(options.data);
    options.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ answers: [{ id: 'q1', answer: ['A'] }] })
    } }] }) });
  };
  const answers = await r.requestQuestionBatch([{ id: 'q1', type: '判断题', title: '测试', options: ['错误', '正确'] }], r.getConfig());
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(answers.get('q1'), 'A', 'A must not be converted to true when choices are reversed');
  const opts = [choice(r, '错误'), choice(r, '正确')];
  assert.equal(new r.ExamAssistant().fillCxQuestion(r.node(), '判断题', answers.get('q1'), opts.map(o => o.el)), true);
  assert.equal(opts[0].input.checked, true);
});

test('legacy API connection test remains plain text without response_format', async () => {
  const r = runtime(); let body;
  r.sandbox.fetch = async (_, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
  };
  assert.equal(await r.requestOpenAI('ping', 'output OK', { openaiApiKey: 'test-only' }), 'OK');
  assert.equal(body.response_format, undefined);
});

test('custom questionLi checkbox icons update without delayed callbacks or double clicks', () => {
  const r = runtime(), ea = new r.ExamAssistant();
  const states = [true, false, false], icons = [], opts = [];
  for (let i = 0; i < 3; i++) {
    const el = r.node('选项' + i), icon = r.node();
    icon.classList = { contains: name => name === 'check_answer_dx' && states[i] };
    icon.click = () => { icon.clicks++; states[i] = !states[i]; };
    el.select('.num_option_dx', icon); opts.push(el); icons.push(icon);
  }
  assert.equal(ea.fillQuestionLiAnswer(r.node(), '多选题', 'BC', opts), true);
  assert.deepEqual(states, [false, true, true]);
  assert.deepEqual(icons.map(icon => icon.clicks), [1, 1, 1]);
  assert.equal(ea.fillQuestionLiAnswer(r.node(), '多选题', 'BC', opts), true);
  assert.deepEqual(icons.map(icon => icon.clicks), [1, 1, 1], 'already-selected choices must not toggle again');
});

test('popup selection ignores unrelated hidden/global confirmation controls', async () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = submission(r, d);
  const stranger = r.node(); r.document.select('#popok, .popok', stranger);
  const pending = ea.saveCxWork(d, { submit: true }); await r.advance(30000);
  assert.equal(await pending, 'submitted');
  assert.equal(stranger.clicks, 0); assert.equal(ui.confirm.clicks, 1);
});

test('platform incomplete warning cancels instead of confirming submission', async () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = submission(r, d), cancel = r.node();
  cancel.ownerDocument = d;
  ui.popup.select('#popcontent', r.node('仍有题目未作答')).select('#popno, .popno', cancel);
  const pending = ea.saveCxWork(d, { submit: true }); await r.advance(30000);
  assert.equal(await pending, 'incomplete'); assert.equal(cancel.clicks, 1); assert.equal(ui.confirm.clicks, 0);
});

test('video quiz uses one-question JSON and verifies selection before submitting', async () => {
  const r = runtime(), d = r.doc(), va = new r.VideoAssistant(), frame = r.node(), box = r.node(), submit = r.node();
  const opts = [choice(r, '√'), choice(r, '×')], next = r.node();
  frame.contentDocument = d; box.ownerDocument = submit.ownerDocument = next.ownerDocument = d;
  d.select('.ans-videoquiz', box).select('.tkTopic_title', r.node('判断题'))
    .select('.ans-videoquiz .tkTopic', r.node('测试判断'))
    .select('.ans-videoquiz-opt', opts.map(o => o.el)).select('#videoquiz-submit', submit);
  submit.addEventListener('click', () => {
    assert.equal(opts[1].input.checked, true);
    d.select('#videoquiz-continue', next);
  });
  r.setConfig({ openaiApiKey: 'test-only' });
  const requests = mockBatchAPI(r, () => ({ answers: [{ id: 'q1', answer: ['错误'] }] }));
  const pending = va.cxSolveVideoQuiz(frame, r.getConfig()); await r.advance(6000);
  assert.equal(await pending, 'resolved');
  assert.equal(requests.length, 1); assert.equal(submit.clicks, 1); assert.equal(next.clicks, 1);
});

// Minimized from reference/page-samples/chaoxing/question.html: #workpopFocus is the header INSIDE
// #workpop, not a second dialog. #popcontent/#popok/#popno are its siblings.
function capturedPopup(r, d) {
  const popup = r.node(), panel = r.node(), heading = r.node('提示');
  const content = r.node('确认提交？'), ok = r.node(), no = r.node();
  popup.attrs.id = 'workpop'; heading.attrs.id = 'workpopFocus';
  panel.parentElement = popup; heading.parentElement = panel;
  content.parentElement = ok.parentElement = no.parentElement = panel;
  for (const n of [popup, panel, heading, content, ok, no]) n.ownerDocument = d;
  heading.closest = selector => /workpop|maskDiv|popDiv/.test(selector) ? popup : null;
  popup.select('#popcontent', content).select('#popok, .popok', ok).select('#popno, .popno', no);
  d.select('#workpop', popup).select('#workpopFocus', heading);
  return { popup, heading, content, ok, no };
}

test('captured workpopFocus header resolves to its enclosing dialog with content and actions', () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = capturedPopup(r, d);
  assert.ok(ea.findFocusPopup([d]) === ui.popup, 'focus header must not be treated as a standalone result popup');
});

test('captured reused dialog reads the second warning and cancels rather than confirming', async () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = capturedPopup(r, d);
  const submit = r.node(); submit.ownerDocument = d;
  d.select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  ui.ok.addEventListener('click', () => { ui.content.innerText = '未达到及格线，是否仍要提交？'; });
  const pending = ea.saveCxWork(d, { submit: true }); await r.advance(30000);
  assert.equal(await pending, 'nopass');
  assert.equal(ui.ok.clicks, 1, 'must not confirm the second failure warning');
  assert.equal(ui.no.clicks, 1, 'must locate cancel beside the header, within the enclosing dialog');
});

test('captured title header does not cause a second click while the first confirmation is pending', async () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = capturedPopup(r, d);
  const submit = r.node(); submit.ownerDocument = d;
  d.select('.btnSubmit.workBtnIndex, .btnSubmit', submit);
  ui.ok.addEventListener('click', () => {
    r.sandbox.setTimeout(() => {
      d.select('#workpop', null).select('#workpopFocus', null)
        .select('.testTit_status, .ceyan_status', r.node('已提交'));
    }, 900);
  });
  const pending = ea.saveCxWork(d, { submit: true }); await r.advance(30000);
  assert.equal(await pending, 'submitted'); assert.equal(ui.ok.clicks, 1);
});

test('captured focus header is ignored when its enclosing overlay is hidden', () => {
  const r = runtime(), d = r.doc(), ea = new r.ExamAssistant(), ui = capturedPopup(r, d);
  r.win.getComputedStyle = node => ({ display: node === ui.popup ? 'none' : 'block', visibility: 'visible', opacity: '1' });
  assert.ok(ea.findFocusPopup([d]) === null, 'hidden parent must hide the focus header');
  assert.ok(ea.findVisiblePopup([d]) === null, 'hidden parent must not be returned as a visible popup');
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.run(); console.log('✅ ' + t.name); }
    catch (e) { failed++; console.error('❌ ' + t.name + ': ' + e.message); }
  }
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
