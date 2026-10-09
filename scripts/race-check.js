/*
 * 异步竞态回归测试
 *
 * 覆盖公共执行入口：CxCourseRunner.tick()/drain()/reset()，以及任务路由取消。
 * 该脚本只读取已构建的 userscript，不修改生产运行时。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bundlePath = path.resolve(__dirname, '..', 'shuakejiang.user.js');
const source = fs.readFileSync(bundlePath, 'utf8');

function loadRuntime() {
  let code = source.replace(
    /\n\s*main\(\);\s*\n\}\)\(\);\s*$/,
    `\n  globalThis.__skj = { CxCourseRunner, CxDom, Site, ExamAssistant, VideoAssistant };\n})();\n`
  );

  const win = {
    _skj_media_hooked: false,
    HTMLMediaElement: function HTMLMediaElement() {},
    self: null,
    top: null,
    window: null,
    addEventListener() {},
    removeEventListener() {},
    postMessage() {}
  };
  win.self = win;
  win.top = win;
  win.window = win;
  Object.defineProperty(win.HTMLMediaElement.prototype, 'playbackRate', {
    configurable: true,
    get() {
      return this._rate || 1;
    },
    set(value) {
      this._rate = value;
    }
  });

  let now = 100000;
  const RealDate = Date;
  class TestDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }

  const sandbox = vm.createContext({
    window: win,
    document: {
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    location: {
      href: 'https://mooc1.chaoxing.com/mycourse/studentstudy',
      hostname: 'mooc1.chaoxing.com'
    },
    console,
    Date: TestDate,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    URL,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  });
  vm.runInContext(code, sandbox);
  return { hook: sandbox.__skj, advance(ms) { now += ms; } };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testDrainSingleFlight() {
  const { hook, advance } = loadRuntime();
  const runner = new hook.CxCourseRunner({ active: true, stopAllMedia() {} });
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  runner.goNext = async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
    return 'none';
  };

  const first = runner.drain({ autoNext: true });
  await new Promise((resolve) => setTimeout(resolve, 1));
  advance(2600);
  const second = runner.drain({ autoNext: true });
  await Promise.all([first, second]);

  assert(calls === 1, `drain should share one in-flight call, got ${calls}`);
  assert(maxInFlight === 1, `drain overlap detected, max=${maxInFlight}`);
  return { calls, maxInFlight };
}

async function testResetDoesNotOverlap() {
  const { hook } = loadRuntime();
  hook.Site.isCxStudentStudy = true;
  hook.CxDom.routeInfo = () => ({ key: 'route-1' });
  hook.CxDom.listTasks = () => [{ type: 'text', source: 'iframe', id: 'task-1' }];

  const runner = new hook.CxCourseRunner({ active: true, stopAllMedia() {} });
  runner.skipReasonOf = () => null;
  let inFlight = 0;
  let maxInFlight = 0;
  let executions = 0;
  runner.execText = async () => {
    executions += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return 'done';
  };

  const config = { videoEnabled: true, examEnabled: true, autoNext: false };
  await runner.tick(config); // establish route
  const oldRun = runner.tick(config); // start task
  await new Promise((resolve) => setTimeout(resolve, 1));
  runner.reset();
  await runner.tick(config);
  await runner.tick(config);
  await oldRun;

  assert(maxInFlight === 1, `reset allowed overlapping tasks, max=${maxInFlight}`);
  assert(executions === 1, `reset should not duplicate the old task, executions=${executions}`);
  return { executions, maxInFlight };
}

async function testExamWorkSingleFlight() {
  const { hook } = loadRuntime();
  const assistant = new hook.ExamAssistant();
  let executions = 0;
  assistant.runCxWorkDoc = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { status: 'done', reason: 'saved', submitSafe: false };
  };
  const config = { examEnabled: true };
  const first = assistant.solveCxWorkDoc({}, config);
  const second = assistant.solveCxWorkDoc({}, config);
  const results = await Promise.all([first, second]);
  assert(executions === 1, `chapter work re-entry detected, executions=${executions}`);
  assert(results[0] === results[1], 'coalesced callers should receive the same result');
  return { executions };
}

async function testRouteCancelsWait() {
  const { hook } = loadRuntime();
  const frame = { contentDocument: { querySelector() { return null; } } };
  hook.CxDom.studyDoc = () => ({});
  hook.CxDom.taskIframeOf = () => frame;
  hook.CxDom.hasDoneKnowledge = () => false;
  const runner = new hook.CxCourseRunner({ active: true, applyPlaybackRate() {}, stopAllMedia() {} });

  const pending = runner.execMedia(
    { type: 'video', id: 'stale-task' },
    { skipFinished: false, muted: false, playbackRate: 1, autoPlay: false, autoSolveVideoQuiz: false },
    'video'
  );
  await new Promise((resolve) => setTimeout(resolve, 1));
  runner.epoch += 1;
  const result = await Promise.race([
    pending.then((value) => ({ kind: 'resolved', value })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 1200))
  ]);

  assert(result.kind === 'resolved' && result.value === 'paused', `route cancellation failed: ${JSON.stringify(result)}`);
  return result;
}

(async () => {
  const results = [];
  results.push(['drain single-flight', await testDrainSingleFlight()]);
  results.push(['reset serialization', await testResetDoesNotOverlap()]);
  results.push(['exam work single-flight', await testExamWorkSingleFlight()]);
  results.push(['route wait cancellation', await testRouteCancelsWait()]);
  for (const [name, result] of results) console.log(`✅ ${name}: ${JSON.stringify(result)}`);
  console.log('✅ 异步竞态回归测试全部通过');
})().catch((error) => {
  console.error(`❌ 异步竞态回归失败: ${error.message}`);
  process.exit(1);
});
