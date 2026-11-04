/* =========================================================================
 * 7. 现代化悬浮设置面板与 UI 渲染 (仅在顶层窗口创建)
 *    视觉风格：WinUI / Fluent 小圆角，主色 #409EFF
 * ========================================================================= */
const SKJ_ICON_PATHS = {
  logo: '<path d="M5.5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>',
  settings: '<path d="M2 4.5h6.5M12.5 4.5H14M2 11.5h1.5M7.5 11.5H14"/><circle cx="10.5" cy="4.5" r="2"/><circle cx="5.5" cy="11.5" r="2"/>',
  dashboard: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  video: '<rect x="1.5" y="3.5" width="9" height="9" rx="1.5"/><path d="M10.5 7l4-2.5v7l-4-2.5"/>',
  ai: '<path d="M8 1.5l1.4 5.1 5.1 1.4-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4z"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  pulse: '<path d="M1.5 8.5h3l2-5 3 9 2-4h3"/>',
  edit: '<path d="M10.5 2.5l3 3-8 8h-3v-3z"/><path d="M9 4l3 3"/>',
  next: '<path d="M3 3.5v9l6.5-4.5z"/><path d="M12.5 3.5v9"/>',
  trash: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>',
  speed: '<path d="M2 11.5a6 6 0 1 1 12 0"/><path d="M8 11.5l2.5-4"/>',
  mute: '<path d="M2 6h2.5L8 3v10l-3.5-3H2z"/><path d="M11 6l3 4M14 6l-3 4"/>',
  check: '<circle cx="8" cy="8" r="6"/><path d="M5.5 8.2L7.2 10l3.3-3.8"/>',
  repeat: '<path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.6M13.5 2.5V5H11M13.5 8a5.5 5.5 0 0 1-9.6 3.6M2.5 13.5V11H5"/>',
  quiz: '<path d="M2.5 3h11v8H7l-3 2.5V11H2.5z"/><path d="M6.5 5.8a1.5 1.5 0 1 1 2 1.4c-.4.2-.5.5-.5.9M8 9.3v.1"/>',
  send: '<path d="M2 8l12-5.5L10.5 14 8 9z"/><path d="M8 9l6-6.5"/>',
  layers: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>',
  parallel: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  key: '<circle cx="5" cy="11" r="2.5"/><path d="M6.8 9.2L13 3M11 5l1.5 1.5M9.5 6.5L11 8"/>',
  font: '<path d="M3 13L7 3h2l4 10M4.8 9h6.4"/>',
  flash: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>',
  save: '<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5V6h5V2.5M5 13.5v-4h6v4"/>',
  done: '<path d="M3.5 8.5l3 3 6-7"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5v.1"/>'
};

function skjIcon(name) {
  return '<svg class="skj-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SKJ_ICON_PATHS[name] || '') + '</svg>';
}

/** 根据状态文案推断指示灯颜色：idle / running / done / error */
function skjStatusTone(text) {
  const s = String(text || '');
  if (/失败|错误|异常/.test(s)) return 'error';
  if (/完成/.test(s)) return 'done';
  if (!s || /^(就绪|空闲)$|已停止/.test(s)) return 'idle';
  return 'running';
}

const SKJ_SAVE_TIP_IDLE = `<span>${skjIcon('info')}大部分设置修改后实时自动生效并保存</span>`;

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
    widget.setAttribute('data-skj-state', 'idle');

    widget.innerHTML = `
      <div id="skj-widget-logo"><span class="skj-logo-tile">${skjIcon('logo')}</span>刷课酱</div>
      <div id="skj-widget-status">就绪</div>
      <button type="button" id="skj-widget-btn" title="打开设置面板" aria-label="打开设置面板">${skjIcon('settings')}</button>
    `;

    document.body.appendChild(widget);

    // 实现平滑拖拽
    let isDragging = false;
    let startX, startY, initialTop, initialRight;

    widget.addEventListener('mousedown', (e) => {
      // 按钮内部是 SVG，需用 closest 判断，避免点击设置按钮时触发拖拽
      if (e.target.closest && e.target.closest('#skj-widget-btn')) return;
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
    const cxRequestSettings = getCxRequestSettings(cfg);
    const escapeAttribute = (value) => skjEscapeHtml(value).replace(/"/g, '&quot;');
    const visionEnabled = cfg.cxFontStrategy === 'vision';
    const independentVision = visionEnabled && cfg.cxVisionUseMain === false;

    // 设置卡片：图标 + 标题/说明 + 右侧开关，点击文字同样可以切换
    const toggleCard = (key, icon, title, desc) => `
              <div class="skj-card">
                <span class="skj-card-icon">${skjIcon(icon)}</span>
                <label class="skj-card-text" for="skj-cfg-${key}">
                  <span class="skj-card-title">${title}</span>
                  <span class="skj-card-desc">${desc}</span>
                </label>
                <label class="skj-switch">
                  <input type="checkbox" id="skj-cfg-${key}" ${cfg[key] ? 'checked' : ''}>
                  <span class="skj-slider"></span>
                </label>
              </div>`;

    modal.innerHTML = `
      <div class="skj-dialog" role="dialog" aria-modal="true" aria-labelledby="skj-dialog-title">
        <div class="skj-header">
          <div class="skj-header-title" id="skj-dialog-title">
            <span class="skj-logo-tile">${skjIcon('logo')}</span>
            <span>刷课酱控制台</span>
            <span class="skj-badge">v2.2.6</span>
          </div>
          <button type="button" class="skj-close" id="skj-close-btn" title="关闭" aria-label="关闭">${skjIcon('close')}</button>
        </div>

        <div class="skj-tabs" role="tablist">
          <button type="button" class="skj-tab active" role="tab" aria-selected="true" data-tab="dashboard">${skjIcon('dashboard')}<span>控制仪表盘</span></button>
          <button type="button" class="skj-tab" role="tab" aria-selected="false" data-tab="video">${skjIcon('video')}<span>视频设置</span></button>
          <button type="button" class="skj-tab" role="tab" aria-selected="false" data-tab="ai">${skjIcon('ai')}<span>AI 接口配置</span></button>
        </div>

        <div class="skj-body">
          <!-- 标签页 1: 仪表盘 -->
          <div class="skj-panel active" id="skj-panel-dashboard" role="tabpanel">
            <div class="skj-status-card" id="skj-status-card" data-skj-state="idle">
              <div class="skj-status-icon">${skjIcon('pulse')}<span class="skj-status-dot"></span></div>
              <div class="skj-card-text">
                <div class="skj-status-label">当前状态</div>
                <div class="skj-status-text" id="skj-modal-status-text">就绪</div>
              </div>
            </div>

            <div class="skj-actions">
              <button type="button" class="skj-btn skj-btn-primary" id="skj-manual-solve-btn">${skjIcon('edit')}立即解答当前题目</button>
              <button type="button" class="skj-btn" id="skj-next-btn">${skjIcon('next')}强制跳转下一节</button>
            </div>

            <div class="skj-section-title">
              <span>运行日志</span>
              <button type="button" class="skj-btn skj-btn-subtle skj-btn-sm" id="skj-quick-clear-btn">${skjIcon('trash')}清空日志</button>
            </div>
            <div class="skj-console" id="skj-console-box"></div>
          </div>

          <!-- 标签页 2: 视频设置 -->
          <div class="skj-panel" id="skj-panel-video" role="tabpanel">
            <div class="skj-section-title">播放流程</div>
            <div class="skj-group">
              ${toggleCard('videoEnabled', 'video', '开启视频助手', '开启后自动接管网页视频并执行设定的播放逻辑')}
              ${toggleCard('autoNext', 'repeat', '自动连续播放 (自动下一节)', '视频播放完毕后自动寻找并点击下一节课程')}
              ${toggleCard('skipFinished', 'check', '自动跳过已完成任务点', '播放视频前检查是否已有完成绿标，已完成则自动秒跳下一节')}
              ${toggleCard('autoSolveVideoQuiz', 'quiz', '自动跳过/求解视频随堂测验 (弹题)', '视频中间停顿弹题时自动答题或解除暂停')}
            </div>

            <div class="skj-section-title">播放参数</div>
            <div class="skj-group">
              ${toggleCard('muted', 'mute', '自动静音播放', '规避浏览器自动播放限制，防止爆音干扰')}
              <div class="skj-card">
                <span class="skj-card-icon">${skjIcon('speed')}</span>
                <label class="skj-card-text" for="skj-cfg-playbackRate">
                  <span class="skj-card-title">视频播放倍速</span>
                  <span class="skj-card-desc">注：内置底层反检测 HOOK，可防止倍速被网页强制重置</span>
                </label>
                <div class="skj-card-action">
                  <select class="skj-input" id="skj-cfg-playbackRate">
                    <option value="1.0" ${cfg.playbackRate == 1.0 ? 'selected' : ''}>1.0x (原速 / 推荐)</option>
                    <option value="1.25" ${cfg.playbackRate == 1.25 ? 'selected' : ''}>1.25x (平稳快速)</option>
                    <option value="1.5" ${cfg.playbackRate == 1.5 ? 'selected' : ''}>1.5x (快速)</option>
                    <option value="2.0" ${cfg.playbackRate == 2.0 ? 'selected' : ''}>2.0x (极速)</option>
                    <option value="2.5" ${cfg.playbackRate == 2.5 ? 'selected' : ''}>2.5x (超速)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- 标签页 3: AI 接口配置 -->
          <div class="skj-panel" id="skj-panel-ai" role="tabpanel">
            <div class="skj-section-title">解题助手</div>
            <div class="skj-group">
              ${toggleCard('examEnabled', 'ai', '开启 AI 解题助手', '遇到章节测验或作业/考试时自动识别题干并请求 AI 答案')}
              ${toggleCard('autoSubmit', 'send', '做完后自动提交', '开启后自动填入、暂存并自动点击提交按钮完成测验')}
              <div class="skj-alert" role="note">
                <span class="skj-alert-icon">!</span>
                <span>已默认开启【自动提交】，答题完毕后将自动确认提交。如需人工检查核对，可在此处关闭此开关。</span>
              </div>
            </div>

            <div class="skj-section-title">批量请求</div>
            <div class="skj-group">
              <div class="skj-card">
                <span class="skj-card-icon">${skjIcon('layers')}</span>
                <div class="skj-card-text">
                  <label class="skj-card-title" for="skj-cfg-cxBatchSize">单次请求题目数（自动保存）</label>
                  <span class="skj-card-desc">默认 4 题，仅对超星章节测验与作业/考试批量解题生效。</span>
                </div>
                <div class="skj-card-action">
                  <input type="number" class="skj-input" id="skj-cfg-cxBatchSize" min="1" max="${CX_MAX_BATCH_SIZE}" step="1" value="${cxRequestSettings.batchSize}">
                </div>
              </div>
              <div class="skj-card">
                <span class="skj-card-icon">${skjIcon('parallel')}</span>
                <div class="skj-card-text">
                  <label class="skj-card-title" for="skj-cfg-cxConcurrency">API 并发请求数（自动保存）</label>
                  <span class="skj-card-desc">默认 3 并发，设为 1 即串行；仅对超星章节测验与作业/考试批量解题生效。</span>
                </div>
                <div class="skj-card-action">
                  <input type="number" class="skj-input" id="skj-cfg-cxConcurrency" min="1" max="${CX_MAX_CONCURRENCY}" step="1" value="${cxRequestSettings.concurrency}">
                </div>
              </div>
            </div>
            <div class="skj-note">以上配置下次答题生效，不影响正在进行的请求；参数过高可能触发 API 限流。</div>

            <div class="skj-section-title">大模型 API 接口参数设置 (需手动保存)</div>
            <div class="skj-card skj-card-stack">
              <div class="skj-card-head">
                <span class="skj-card-icon">${skjIcon('key')}</span>
                <div class="skj-card-text">
                  <span class="skj-card-title">OpenAI 兼容接口</span>
                  <span class="skj-card-desc">修改以下参数后，点击底部的“保存 API 配置”生效</span>
                </div>
              </div>
              <div class="skj-fields">
                <div class="skj-field">
                  <label class="skj-field-label" for="skj-cfg-openaiBaseUrl">API 接口地址 (Base URL)</label>
                  <input type="text" class="skj-input" id="skj-cfg-openaiBaseUrl" placeholder="https://api.openai.com/v1" value="${escapeAttribute(cfg.openaiBaseUrl)}">
                  <div class="skj-card-desc">支持任意 OpenAI 兼容地址，例如 DeepSeek、OneAPI、SiliconFlow 或本地 Ollama</div>
                </div>
                <div class="skj-field">
                  <label class="skj-field-label" for="skj-cfg-openaiApiKey">API Key (密钥)</label>
                  <input type="password" class="skj-input" id="skj-cfg-openaiApiKey" placeholder="sk-..." value="${escapeAttribute(cfg.openaiApiKey)}" autocomplete="off">
                  <div class="skj-card-desc">密钥保存在本地配置中；调用时仅发送给您配置的对应 API 地址，请勿使用不可信接口</div>
                </div>
                <div class="skj-field">
                  <label class="skj-field-label" for="skj-cfg-openaiModel">模型名称 (Model)</label>
                  <input type="text" class="skj-input" id="skj-cfg-openaiModel" placeholder="gpt-4o-mini" value="${escapeAttribute(cfg.openaiModel)}">
                  <div class="skj-card-desc">例如：gpt-4o-mini、deepseek-chat、qwen-turbo、claude-3-haiku 等</div>
                </div>
              </div>
            </div>

            <div class="skj-section-title">超星字体混淆</div>
            <div class="skj-card skj-card-stack">
              <div class="skj-card-head">
                <span class="skj-card-icon">${skjIcon('font')}</span>
                <div class="skj-card-text">
                  <label class="skj-card-title" for="skj-cfg-cxFontStrategy">超星字体混淆处理策略（自动保存）</label>
                  <span class="skj-card-desc">手动选择一种策略，不自动回退。非混淆题继续走原有解题流程。</span>
                </div>
                <div class="skj-card-action">
                  <select class="skj-input" id="skj-cfg-cxFontStrategy">
                    <option value="table" ${!visionEnabled ? 'selected' : ''}>查现有指纹表（默认）</option>
                    <option value="vision" ${visionEnabled ? 'selected' : ''}>图片视觉识别</option>
                  </select>
                </div>
              </div>
              <div class="skj-fields">
                <div class="skj-card-desc">仅图片视觉会向所配置的 API 上传混淆区域用到的编号汉字图片；识字后仍由主模型按原有批请求解题。识别失败不会自动提交；视觉转写仍可能误认汉字，建议关闭自动提交后核对。</div>
              </div>

              <div id="skj-cx-vision-settings" ${visionEnabled ? '' : 'hidden'} class="skj-fields">
                <div class="skj-field">
                  <label class="skj-field-label" for="skj-cfg-cxVisionUseMain">视觉 API 来源（自动保存）</label>
                  <select class="skj-input" id="skj-cfg-cxVisionUseMain">
                    <option value="true" ${cfg.cxVisionUseMain !== false ? 'selected' : ''}>复用主解题模型</option>
                    <option value="false" ${cfg.cxVisionUseMain === false ? 'selected' : ''}>独立视觉 API</option>
                  </select>
                  <div class="skj-card-desc">复用时主解题模型必须支持图片；独立模式的视觉模型也必须支持图片。两套 API 不会自动回退或混用。</div>
                </div>

                <div id="skj-cx-vision-independent" ${independentVision ? '' : 'hidden'} class="skj-fields">
                  <div class="skj-field">
                    <label class="skj-field-label" for="skj-cfg-cxVisionBaseUrl">独立视觉 Base URL（需手动保存）</label>
                    <input type="text" class="skj-input" id="skj-cfg-cxVisionBaseUrl" placeholder="https://api.openai.com/v1" value="${escapeAttribute(cfg.cxVisionBaseUrl)}" ${independentVision ? '' : 'disabled'}>
                  </div>
                  <div class="skj-field">
                    <label class="skj-field-label" for="skj-cfg-cxVisionApiKey">独立视觉 API Key（需手动保存）</label>
                    <input type="password" class="skj-input" id="skj-cfg-cxVisionApiKey" placeholder="sk-..." value="${escapeAttribute(cfg.cxVisionApiKey)}" ${independentVision ? '' : 'disabled'} autocomplete="off">
                  </div>
                  <div class="skj-field">
                    <label class="skj-field-label" for="skj-cfg-cxVisionModel">独立视觉 Model（需手动保存）</label>
                    <input type="text" class="skj-input" id="skj-cfg-cxVisionModel" placeholder="支持图片的模型名称" value="${escapeAttribute(cfg.cxVisionModel)}" ${independentVision ? '' : 'disabled'}>
                    <div class="skj-card-desc">三个独立参数必须全部填写，再点击下方保存。切换或隐藏此区域不会清空已保存的独立配置。</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="skj-note">连接测试仅检查主解题 API 的文本响应，不验证模型的图片识别能力。</div>
          </div>
        </div>

        <div class="skj-footer">
          <div id="skj-save-tip" aria-live="polite" class="skj-footer-status">${SKJ_SAVE_TIP_IDLE}</div>
          <div class="skj-footer-actions" id="skj-footer-ai-actions" hidden>
            <button type="button" class="skj-btn" id="skj-test-ai-btn">${skjIcon('flash')}测试 API 连接</button>
            <button type="button" class="skj-btn skj-btn-primary" id="skj-save-api-btn">${skjIcon('save')}保存 API 配置</button>
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
        tabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.skj-panel').forEach((p) => p.classList.remove('active'));

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        this.activeTab = tab.dataset.tab;
        const panelId = 'skj-panel-' + tab.dataset.tab;
        document.getElementById(panelId)?.classList.add('active');
        // API 测试/保存按钮固定在底部命令栏，仅 AI 配置页显示
        const aiActions = document.getElementById('skj-footer-ai-actions');
        if (aiActions) aiActions.hidden = tab.dataset.tab !== 'ai';
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
      'skj-cfg-autoSubmit',
      'skj-cfg-cxBatchSize',
      'skj-cfg-cxConcurrency',
      'skj-cfg-cxFontStrategy',
      'skj-cfg-cxVisionUseMain'
    ];

    autoSaveSelectAndSwitches.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          this.saveGeneralSettings(id.replace('skj-cfg-', ''));
        });
      }
    });

    this.updateCxVisionSettings();

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
    if (changedKey === 'cxBatchSize' || changedKey === 'cxConcurrency') {
      const input = document.getElementById('skj-cfg-' + changedKey);
      const cfg = getConfig();
      const settings = getCxRequestSettings({ [changedKey]: input?.value ?? cfg[changedKey] });
      const value = changedKey === 'cxBatchSize' ? settings.batchSize : settings.concurrency;
      setConfig({ [changedKey]: value });
      if (input) input.value = String(value);
      // 下次答题才采用新参数，不重启助手或取消当前请求。
      this.showSaveTip('设置已实时自动保存，下次答题生效');
      return;
    }
    const rateEl = document.getElementById('skj-cfg-playbackRate');
    const cfg = getConfig();
    const strategyEl = document.getElementById('skj-cfg-cxFontStrategy');
    const visionSourceEl = document.getElementById('skj-cfg-cxVisionUseMain');
    const newCfg = {
      videoEnabled: document.getElementById('skj-cfg-videoEnabled')?.checked ?? true,
      autoNext: document.getElementById('skj-cfg-autoNext')?.checked ?? true,
      skipFinished: document.getElementById('skj-cfg-skipFinished')?.checked ?? true,
      muted: document.getElementById('skj-cfg-muted')?.checked ?? true,
      autoSolveVideoQuiz: document.getElementById('skj-cfg-autoSolveVideoQuiz')?.checked ?? true,
      playbackRate: parseFloat(rateEl?.value || '1.0'),

      examEnabled: document.getElementById('skj-cfg-examEnabled')?.checked ?? true,
      autoSubmit: document.getElementById('skj-cfg-autoSubmit')?.checked ?? true,
      cxFontStrategy: strategyEl ? (strategyEl.value === 'vision' ? 'vision' : 'table') : cfg.cxFontStrategy,
      cxVisionUseMain: visionSourceEl ? visionSourceEl.value !== 'false' : cfg.cxVisionUseMain
    };
    // 只保存用户本次修改的字段，避免旧面板覆盖其它标签页保存的选项。
    setConfig(changedKey ? { [changedKey]: newCfg[changedKey] } : newCfg);
    Object.assign(newCfg, getConfig());
    this.updateCxVisionSettings();
    this.videoAssist.optionsChanged?.();

    // 智慧树 StuStudy 的官方播放器不支持脚本侧调速；按原插件行为固定原速，
    // 避免设置面板直接写 playbackRate 破坏播放器状态。静音仍同步到媒体元素。
    const videos = this.videoAssist.findMediaElements();
    for (const v of videos) {
      v.muted = !!newCfg.muted;
      if (!Site.isZhihuishu) this.videoAssist.applyPlaybackRate(v, newCfg.playbackRate);
    }
    if (Site.isZhihuishu) this.videoAssist.zhsApplyControlBarRate(1);

    this.showSaveTip('设置已实时自动保存并生效');
  }

  // 只切换可见性与可编辑性，保留输入中的草稿以及已保存的独立配置。
  updateCxVisionSettings() {
    const cfg = getConfig();
    const strategy = document.getElementById('skj-cfg-cxFontStrategy')?.value ?? cfg.cxFontStrategy;
    const source = document.getElementById('skj-cfg-cxVisionUseMain')?.value ?? String(cfg.cxVisionUseMain);
    const visionEnabled = strategy === 'vision';
    const independentVision = visionEnabled && source === 'false';
    const settings = document.getElementById('skj-cx-vision-settings');
    const independent = document.getElementById('skj-cx-vision-independent');
    if (settings) settings.hidden = !visionEnabled;
    if (independent) independent.hidden = !independentVision;
    for (const key of ['cxVisionBaseUrl', 'cxVisionApiKey', 'cxVisionModel']) {
      const input = document.getElementById('skj-cfg-' + key);
      if (input) input.disabled = !independentVision;
    }
  }

  /**
   * 保存大模型 API 接口配置（用户手动点击保存）
   */
  saveApiSettings(silent = false) {
    const inputBaseUrl = document.getElementById('skj-cfg-openaiBaseUrl')?.value.trim() || 'https://api.openai.com/v1';
    const inputApiKey = document.getElementById('skj-cfg-openaiApiKey')?.value.trim() || '';
    const inputModel = document.getElementById('skj-cfg-openaiModel')?.value.trim() || 'gpt-4o-mini';

    const patch = {
      openaiBaseUrl: inputBaseUrl,
      openaiApiKey: inputApiKey,
      openaiModel: inputModel
    };
    for (const key of ['cxVisionBaseUrl', 'cxVisionApiKey', 'cxVisionModel']) {
      const input = document.getElementById('skj-cfg-' + key);
      // 隐藏/禁用字段不参与保存，避免旧面板或空输入覆盖其它标签页的独立配置。
      if (input && !input.disabled) patch[key] = input.value.trim();
    }
    setConfig(patch);

    this.showSaveTip('API 配置已成功保存');
    if (!silent) {
      AppState.log(`API 配置已保存！模型: ${inputModel}`);
      alert('✅ API 接口配置已成功保存并全局生效！');
    }
  }

  showSaveTip(msg) {
    const tip = document.getElementById('skj-save-tip');
    if (tip) {
      tip.innerHTML = `<span class="skj-tip-success">${skjIcon('done')}${msg}</span>`;
      if (this._tipTimer) clearTimeout(this._tipTimer);
      this._tipTimer = setTimeout(() => {
        tip.innerHTML = SKJ_SAVE_TIP_IDLE;
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
    const tone = skjStatusTone(state.status);
    document.getElementById('skj-widget')?.setAttribute('data-skj-state', tone);
    document.getElementById('skj-status-card')?.setAttribute('data-skj-state', tone);
  }

  updateLogs(state) {
    const box = document.getElementById('skj-console-box');
    if (!box) return;
    box.innerHTML = state.logs
      .map((l) => `<div class="skj-log-item ${skjEscapeHtml(l.level)}"><span class="skj-log-time">${skjEscapeHtml(l.time)}</span><span>${skjEscapeHtml(l.msg)}</span></div>`)
      .join('');
    box.scrollTop = box.scrollHeight;
  }
}
