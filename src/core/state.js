/* =========================================================================
 * 2. 日志与状态管理器
 * ========================================================================= */
const AppState = {
  status: '就绪',
  isPlayingVideo: false,
  isSolvingQuiz: false,
  logs: [],
  listeners: new Set(),

  setStatus(text) {
    this.status = text;
    this.notify();
  },

  log(msg, level = 'info') {
    const time = new Date().toLocaleTimeString();
    const item = { time, msg, level };
    this.logs.push(item);
    if (this.logs.length > 80) this.logs.shift();
    console.log(`[刷客酱][${time}] ${msg}`);
    this.notify();
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  notify() {
    this.listeners.forEach((fn) => {
      try {
        fn(this);
      } catch (e) {}
    });
  }
};
