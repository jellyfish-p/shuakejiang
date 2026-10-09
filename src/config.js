/* =========================================================================
 * 1. 存储与配置中心
 * ========================================================================= */
const Storage = {
  get(key, defaultVal) {
    try {
      let gmVal = undefined;
      if (typeof GM_getValue !== 'undefined') {
        gmVal = GM_getValue(key, undefined);
      }
      if (gmVal !== undefined && gmVal !== null && gmVal !== '') {
        return gmVal;
      }
      const localVal = localStorage.getItem('skj_' + key);
      if (localVal !== null && localVal !== undefined) {
        const parsed = JSON.parse(localVal);
        if (parsed !== undefined && parsed !== null && parsed !== '') {
          // 同步回 GM_setValue 实现跨域多平台全局共享
          if (typeof GM_setValue !== 'undefined') {
            try {
              GM_setValue(key, parsed);
            } catch (e) {}
          }
          return parsed;
        }
      }
      return gmVal !== undefined && gmVal !== null ? gmVal : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },
  set(key, val) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, val);
      }
      try {
        localStorage.setItem('skj_' + key, JSON.stringify(val));
      } catch (e) {}
    } catch (e) {
      console.error('[刷课酱] 保存配置失败:', e);
    }
  }
};

const DEFAULT_CONFIG = {
  // 视频助手设置
  videoEnabled: true,
  autoPlay: true,
  autoNext: true,
  skipFinished: true, // 检查任务点是否已完成并自动跳过
  playbackRate: 1.0, // 默认 1.0x 原速
  muted: true,
  autoSolveVideoQuiz: true,

  // AI 解题助手设置（OpenAI 兼容格式）
  examEnabled: true,
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  openaiApiKey: '',
  openaiModel: 'deepseek-flash',
  openaiTemperature: 0.1,
  autoSubmit: true, // 默认开启做题自动提交
  solveInterval: 2000, // 每题间隔（毫秒）

  // 界面设置
  panelPosition: { top: 80, right: 20 }
};

const CONFIG_VERSION_KEY = 'configVersion';

function getConfig() {
  let lastCfg = { ...DEFAULT_CONFIG };
  for (let attempt = 0; attempt < 3; attempt++) {
    const startVersion = Number(Storage.get(CONFIG_VERSION_KEY, 0)) || 0;
    if (startVersion % 2 === 1) continue; // writer is between begin/end markers

    const cfg = {};
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      cfg[k] = Storage.get(k, DEFAULT_CONFIG[k]);
    }
    const endVersion = Number(Storage.get(CONFIG_VERSION_KEY, 0)) || 0;
    lastCfg = cfg;
    if (startVersion === endVersion && endVersion % 2 === 0) return cfg;
  }
  return lastCfg;
}

function setConfig(cfg) {
  const currentVersion = Number(Storage.get(CONFIG_VERSION_KEY, 0)) || 0;
  const baseVersion = currentVersion % 2 === 0 ? currentVersion : currentVersion + 1;
  Storage.set(CONFIG_VERSION_KEY, baseVersion + 1);
  try {
    for (const k of Object.keys(cfg)) {
      Storage.set(k, cfg[k]);
    }
  } finally {
    Storage.set(CONFIG_VERSION_KEY, baseVersion + 2);
  }
}
