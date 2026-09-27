/* =========================================================================
 * 1. 存储与配置中心
 * ========================================================================= */
const Storage = {
  get(key, defaultVal) {
    try {
      if (typeof GM_getValue !== 'undefined') {
        return GM_getValue(key, defaultVal);
      }
      const val = localStorage.getItem('skj_' + key);
      return val !== null ? JSON.parse(val) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },
  set(key, val) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, val);
        return;
      }
      localStorage.setItem('skj_' + key, JSON.stringify(val));
    } catch (e) {
      console.error('[刷客酱] 保存配置失败:', e);
    }
  }
};

const DEFAULT_CONFIG = {
  // 视频助手设置
  videoEnabled: true,
  autoPlay: true,
  autoNext: true,
  skipFinished: true, // 检查任务点是否已完成并自动跳过
  playbackRate: 1.5,
  muted: true,
  autoSolveVideoQuiz: true,

  // AI 解题助手设置 (OpenAI 兼容格式)
  examEnabled: true,
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  openaiTemperature: 0.1,
  autoSubmit: false,
  solveInterval: 2000, // 每题间隔（毫秒）

  // 界面设置
  panelPosition: { top: 80, right: 20 }
};

function getConfig() {
  const cfg = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    cfg[k] = Storage.get(k, DEFAULT_CONFIG[k]);
  }
  return cfg;
}

function setConfig(cfg) {
  for (const k of Object.keys(cfg)) {
    Storage.set(k, cfg[k]);
  }
}
