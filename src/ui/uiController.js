/* =========================================================================
 * 7. 现代化悬浮设置面板与 UI 渲染 (仅在顶层窗口创建)
 * ========================================================================= */
class UIController {
  constructor(videoAssist, examAssist) {
    this.videoAssist = videoAssist;
    this.examAssist = examAssist;
    this.panelOpen = false;
    this.activeTab = 'dashboard';
  }

  init() {
    // 仅在顶层页面加载 UI，避免在嵌套的数百个 iframe 中重复渲染悬浮窗
    if (window.self !== window.top) return;

    this.createStyles();
    this.createFloatingWidget();
    this.createSettingsModal();
    this.bindEvents();

    // 订阅状态更新
    AppState.subscribe((state) => {
      this.updateBadge(state);
      this.updateLogs(state);
    });

    // 注册油猴菜单
    if (typeof GM_registerMenuCommand !== 'undefined') {
      GM_registerMenuCommand('⚙️ 打开刷课酱设置', () => this.toggleModal(true));
      GM_registerMenuCommand('📝 立即解答当前页面题目', () => this.examAssist.solveCurrentPage(true));
    }
  }
  createStyles() {
    const style = document.createElement("style");
    style.id = "skj-styles";
    style.textContent = UI_STYLES;
    document.head.appendChild(style);
  }


  createFloatingWidget() {
    const cfg = getConfig();
    const pos = cfg.panelPosition || { top: 80, right: 20 };

    const widget = document.createElement('div');
    widget.id = 'skj-widget';
    widget.style.top = pos.top + 'px';
    widget.style.right = pos.right + 'px';

    widget.innerHTML = `
      <div id="skj-widget-logo">🤖 刷课酱</div>
      <div id="skj-widget-status">就绪</div>
      <button id="skj-widget-btn" title="点击打开设置面板">⚙️</button>
    `;

    document.body.appendChild(widget);

    // 实现平滑拖拽
    let isDragging = false;
    let startX, startY, initialTop, initialRight;

    widget.addEventListener('mousedown', (e) => {
      if (e.target.id === 'skj-widget-btn') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialTop = widget.offsetTop;
      initialRight = window.innerWidth - (widget.offsetLeft + widget.offsetWidth);
      widget.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newTop = Math.max(10, Math.min(window.innerHeight - 50, initialTop + dy));
      const newRight = Math.max(10, Math.min(window.innerWidth - 120, initialRight - dx));
      widget.style.top = newTop + 'px';
      widget.style.right = newRight + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      widget.style.transition = '';
      setConfig({ panelPosition: {
        top: parseInt(widget.style.top, 10),
        right: parseInt(widget.style.right, 10)
      } });
    });
  }

  createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'skj-modal';

    const cfg = getConfig();

    modal.innerHTML = `
      <div class="skj-dialog">
        <div class="skj-header">
          <div class="skj-header-title">
            <span>🤖 刷课酱控制台</span>
            <span class="skj-badge">v2.1.1</span>
          </div>
          <button class="skj-close" id="skj-close-btn">&times;</button>
        </div>

        <div class="skj-tabs">
          <div class="skj-tab active" data-tab="dashboard">📊 控制仪表盘</div>
          <div class="skj-tab" data-tab="video">🎬 视频设置</div>
          <div class="skj-tab" data-tab="ai">🧠 AI 接口配置</div>
        </div>

        <div class="skj-body">
          <!-- 标签页 1: 仪表盘 -->
          <div class="skj-panel active" id="skj-panel-dashboard">
            <div class="skj-status-card">
              <div>
                <div style="font-weight: 700; color: #1e293b; margin-bottom: 2px;">
                  <span class="skj-status-dot"></span>当前状态
                </div>
                <div id="skj-modal-status-text" style="color: #64748b; font-size: 13px;">就绪</div>
              </div>
              <div>
                <button class="skj-btn skj-btn-secondary" id="skj-quick-clear-btn" style="padding: 6px 10px;">清空日志</button>
              </div>
            </div>

            <div class="skj-actions">
              <button class="skj-btn skj-btn-primary" id="skj-manual-solve-btn">📝 立即解答当前题目</button>
              <button class="skj-btn skj-btn-secondary" id="skj-next-btn">⏭️ 强制跳转下一节</button>
            </div>

            <div class="skj-form-label">运行日志</div>
            <div class="skj-console" id="skj-console-box"></div>
          </div>

          <!-- 标签页 2: 视频设置 -->
          <div class="skj-panel" id="skj-panel-video">
            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">开启视频助手</div>
                <div class="skj-form-desc">开启后自动接管网页视频并执行设定的播放逻辑</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-videoEnabled" ${cfg.videoEnabled ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">自动连续播放 (自动下一节)</div>
                <div class="skj-form-desc">视频播放完毕后自动寻找并点击下一节课程</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-autoNext" ${cfg.autoNext ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">自动跳过已完成任务点</div>
                <div class="skj-form-desc">播放视频前检查是否已有完成绿标，已完成则自动秒跳下一节</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-skipFinished" ${cfg.skipFinished ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">自动静音播放</div>
                <div class="skj-form-desc">规避浏览器自动播放限制，防止爆音干扰</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-muted" ${cfg.muted ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">自动跳过/求解视频随堂测验 (弹题)</div>
                <div class="skj-form-desc">视频中间停顿弹题时自动答题或解除暂停</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-autoSolveVideoQuiz" ${cfg.autoSolveVideoQuiz ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-form-item" style="margin-top: 16px;">
              <div class="skj-form-label">视频播放倍速</div>
              <select class="skj-input" id="skj-cfg-playbackRate">
                <option value="1.0" ${cfg.playbackRate == 1.0 ? 'selected' : ''}>1.0x (原速 / 推荐)</option>
                <option value="1.25" ${cfg.playbackRate == 1.25 ? 'selected' : ''}>1.25x (平稳快速)</option>
                <option value="1.5" ${cfg.playbackRate == 1.5 ? 'selected' : ''}>1.5x (快速)</option>
                <option value="2.0" ${cfg.playbackRate == 2.0 ? 'selected' : ''}>2.0x (极速)</option>
                <option value="2.5" ${cfg.playbackRate == 2.5 ? 'selected' : ''}>2.5x (超速)</option>
              </select>
              <div class="skj-form-desc">注：内置底层反检测 HOOK，可防止倍速被网页强制重置</div>
            </div>
          </div>

          <!-- 标签页 3: AI 接口配置 -->
          <div class="skj-panel" id="skj-panel-ai">
            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">开启 AI 解题助手</div>
                <div class="skj-form-desc">遇到章节测验或作业/考试时自动识别题干并请求 AI 答案</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-examEnabled" ${cfg.examEnabled ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-switch-item">
              <div>
                <div class="skj-switch-text">做完后自动提交</div>
                <div class="skj-form-desc">开启后自动填入、暂存并自动点击提交按钮完成测验</div>
              </div>
              <label class="skj-switch">
                <input type="checkbox" id="skj-cfg-autoSubmit" ${cfg.autoSubmit ? 'checked' : ''}>
                <span class="skj-slider"></span>
              </label>
            </div>

            <div class="skj-alert">
              <span>💡</span>
              <span>已默认开启【自动提交】，答题完毕后将自动确认提交。如需人工检查核对，可在此处关闭此开关。</span>
            </div>

            <div style="margin-top: 18px; margin-bottom: 8px; font-size: 13px; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 6px;">
              <span>🔑</span>
              <span>大模型 API 接口参数设置 (需手动保存)</span>
            </div>

            <div class="skj-form-item">
              <div class="skj-form-label">API 接口地址 (Base URL)</div>
              <input type="text" class="skj-input" id="skj-cfg-openaiBaseUrl" placeholder="https://api.openai.com/v1" value="${cfg.openaiBaseUrl}">
              <div class="skj-form-desc">支持任意 OpenAI 兼容地址，例如 DeepSeek、OneAPI、SiliconFlow 或本地 Ollama</div>
            </div>

            <div class="skj-form-item">
              <div class="skj-form-label">API Key (密钥)</div>
              <input type="password" class="skj-input" id="skj-cfg-openaiApiKey" placeholder="sk-..." value="${cfg.openaiApiKey}">
              <div class="skj-form-desc">密钥仅保存在您本地油猴脚本存储中，跨网站全局共享，绝不上传至任何第三方服务器</div>
            </div>

            <div class="skj-form-item">
              <div class="skj-form-label">模型名称 (Model)</div>
              <input type="text" class="skj-input" id="skj-cfg-openaiModel" placeholder="gpt-4o-mini" value="${cfg.openaiModel}">
              <div class="skj-form-desc">例如：gpt-4o-mini、deepseek-chat、qwen-turbo、claude-3-haiku 等</div>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 16px;">
              <button class="skj-btn skj-btn-secondary" id="skj-test-ai-btn">⚡ 测试 API 连接</button>
              <button class="skj-btn skj-btn-primary" id="skj-save-api-btn">💾 保存 API 配置</button>
            </div>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
  }

  bindEvents() {
    const widgetBtn = document.getElementById('skj-widget-btn');
    const modal = document.getElementById('skj-modal');
    const closeBtn = document.getElementById('skj-close-btn');

    widgetBtn.addEventListener('click', () => this.toggleModal(true));
    closeBtn.addEventListener('click', () => this.toggleModal(false));

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.toggleModal(false);
    });

    // 标签页切换
    const tabs = document.querySelectorAll('.skj-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.skj-panel').forEach((p) => p.classList.remove('active'));

        tab.classList.add('active');
        const panelId = 'skj-panel-' + tab.dataset.tab;
        document.getElementById(panelId)?.classList.add('active');
      });
    });

    // 手动保存 API 配置按钮
    document.getElementById('skj-save-api-btn')?.addEventListener('click', () => {
      this.saveApiSettings(false);
    });

    // 弹窗关闭按钮
    document.getElementById('skj-modal-close-bottom-btn')?.addEventListener('click', () => {
      this.toggleModal(false);
    });

    // 监听大部分开关与选择框变动，实时全自动保存
    const autoSaveSelectAndSwitches = [
      'skj-cfg-videoEnabled',
      'skj-cfg-autoNext',
      'skj-cfg-skipFinished',
      'skj-cfg-muted',
      'skj-cfg-autoSolveVideoQuiz',
      'skj-cfg-playbackRate',
      'skj-cfg-examEnabled',
      'skj-cfg-autoSubmit'
    ];

    autoSaveSelectAndSwitches.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          this.saveGeneralSettings(id.replace('skj-cfg-', ''));
        });
      }
    });

    // 测试 API
    document.getElementById('skj-test-ai-btn')?.addEventListener('click', async () => {
      this.saveApiSettings(true);
      const cfg = getConfig();
      AppState.log('正在测试 OpenAI API 连接...');
      try {
        const testRes = await requestOpenAI('请回答数字：1+1等于几？', null, cfg);
        AppState.log(`API 测试成功！模型回复: ${testRes.trim()}`);
        alert(`✅ API 连接成功！\n模型返回: ${testRes.trim()}`);
      } catch (e) {
        AppState.log(`API 测试失败: ${e.message}`, 'error');
        alert(`❌ API 连接失败:\n${e.message}`);
      }
    });

    // 一键解题
    document.getElementById('skj-manual-solve-btn')?.addEventListener('click', () => {
      this.examAssist.solveCurrentPage(true);
    });

    // 强制下一节
    document.getElementById('skj-next-btn')?.addEventListener('click', () => {
      this.videoAssist.triggerNextChapter();
    });

    // 清空日志
    document.getElementById('skj-quick-clear-btn')?.addEventListener('click', () => {
      AppState.logs = [];
      this.updateLogs(AppState);
    });
  }

  /**
   * 保存常规开关与选择设置（实时自动保存）
   */
  saveGeneralSettings(changedKey = null) {
    const rateEl = document.getElementById('skj-cfg-playbackRate');
    const newCfg = {
      videoEnabled: document.getElementById('skj-cfg-videoEnabled')?.checked ?? true,
      autoNext: document.getElementById('skj-cfg-autoNext')?.checked ?? true,
      skipFinished: document.getElementById('skj-cfg-skipFinished')?.checked ?? true,
      muted: document.getElementById('skj-cfg-muted')?.checked ?? true,
      autoSolveVideoQuiz: document.getElementById('skj-cfg-autoSolveVideoQuiz')?.checked ?? true,
      playbackRate: parseFloat(rateEl?.value || '1.0'),

      examEnabled: document.getElementById('skj-cfg-examEnabled')?.checked ?? true,
      autoSubmit: document.getElementById('skj-cfg-autoSubmit')?.checked ?? true
    };
    // 只保存用户本次修改的字段，避免旧面板覆盖其它标签页保存的选项。
    setConfig(changedKey ? { [changedKey]: newCfg[changedKey] } : newCfg);
    Object.assign(newCfg, getConfig());
    this.videoAssist.optionsChanged?.();

    // 立即向当前页面所有视频同步新设定的倍速和静音状态
    const videos = this.videoAssist.findMediaElements();
    for (const v of videos) {
      v.muted = !!newCfg.muted;
      this.videoAssist.applyPlaybackRate(v, newCfg.playbackRate);
    }

    this.showSaveTip('✅ 设置已实时自动保存并生效');
  }

  /**
   * 保存大模型 API 接口配置（用户手动点击保存）
   */
  saveApiSettings(silent = false) {
    const inputBaseUrl = document.getElementById('skj-cfg-openaiBaseUrl')?.value.trim() || 'https://api.openai.com/v1';
    const inputApiKey = document.getElementById('skj-cfg-openaiApiKey')?.value.trim() || '';
    const inputModel = document.getElementById('skj-cfg-openaiModel')?.value.trim() || 'gpt-4o-mini';

    setConfig({
      openaiBaseUrl: inputBaseUrl,
      openaiApiKey: inputApiKey,
      openaiModel: inputModel
    });

    this.showSaveTip('✅ API 配置已成功保存！');
    if (!silent) {
      AppState.log(`API 配置已保存！模型: ${inputModel}`);
      alert('✅ API 接口配置已成功保存并全局生效！');
    }
  }

  showSaveTip(msg) {
    const tip = document.getElementById('skj-save-tip');
    if (tip) {
      tip.innerHTML = `<span style="color:#10b981;font-weight:600;">${msg}</span>`;
      if (this._tipTimer) clearTimeout(this._tipTimer);
      this._tipTimer = setTimeout(() => {
        tip.innerHTML = '<span>⚡ 大部分设置修改后实时自动生效并保存</span>';
      }, 2500);
    }
  }

  toggleModal(show) {
    const modal = document.getElementById('skj-modal');
    if (show) {
      modal.classList.add('show');
    } else {
      modal.classList.remove('show');
    }
  }

  updateBadge(state) {
    const badge = document.getElementById('skj-widget-status');
    const modalStatus = document.getElementById('skj-modal-status-text');
    if (badge) badge.innerText = state.status;
    if (modalStatus) modalStatus.innerText = state.status;
  }

  updateLogs(state) {
    const box = document.getElementById('skj-console-box');
    if (!box) return;
    box.innerHTML = state.logs
      .map((l) => `<div class="skj-log-item ${l.level}">[${l.time}] ${l.msg}</div>`)
      .join('');
    box.scrollTop = box.scrollHeight;
  }
}
