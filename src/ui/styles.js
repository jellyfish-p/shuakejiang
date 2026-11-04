/* =========================================================================
 * 控制面板样式表（WinUI / Fluent 风格，主色 #409EFF）
 *   - 控件圆角 4px，浮层与对话框圆角 8px
 *   - 色板沿用 WinUI 浅色主题的中性色与描边透明度
 * ========================================================================= */
const UI_STYLES = `
        #skj-widget, #skj-modal {
          --skj-accent: #409EFF;
          --skj-accent-hover: #53A8FF;
          --skj-accent-pressed: #79BBFF;
          --skj-accent-text: #2B7BD6;
          --skj-accent-subtle: #ECF5FF;
          --skj-text-1: #1B1B1B;
          --skj-text-2: #5D5D5D;
          --skj-text-3: #8A8A8A;
          --skj-text-disabled: #A0A0A0;
          --skj-layer: #F3F3F3;
          --skj-card: #FBFBFB;
          --skj-card-hover: #F6F6F6;
          --skj-control: #FBFBFB;
          --skj-control-hover: #F6F6F6;
          --skj-control-pressed: #F2F2F2;
          --skj-subtle-hover: rgba(0, 0, 0, 0.0373);
          --skj-subtle-pressed: rgba(0, 0, 0, 0.0241);
          --skj-stroke: rgba(0, 0, 0, 0.0578);
          --skj-stroke-bottom: rgba(0, 0, 0, 0.1622);
          --skj-stroke-input: rgba(0, 0, 0, 0.4458);
          --skj-divider: rgba(0, 0, 0, 0.0803);
          --skj-success: #0F7B0F;
          --skj-caution: #9D5D00;
          --skj-caution-bg: #FFF4CE;
          --skj-critical: #C42B1C;
          --skj-radius: 4px;
          --skj-radius-lg: 8px;
          --skj-ease: cubic-bezier(0, 0, 0, 1);

          font-family: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont,
            "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
          font-size: 14px;
          line-height: 20px;
          font-weight: 400;
          letter-spacing: normal;
          text-align: left;
          color: var(--skj-text-1);
          box-sizing: border-box;
          z-index: 2147483640;
          -webkit-font-smoothing: antialiased;
        }
        #skj-widget *, #skj-modal *,
        #skj-widget *::before, #skj-modal *::before,
        #skj-widget *::after, #skj-modal *::after {
          box-sizing: border-box;
        }
        #skj-widget button, #skj-modal button,
        #skj-modal input, #skj-modal select, #skj-modal label {
          font: inherit;
          color: inherit;
          margin: 0;
          letter-spacing: inherit;
          text-transform: none;
        }
        #skj-modal [hidden] {
          display: none !important;
        }
        .skj-icon {
          width: 16px;
          height: 16px;
          flex: none;
          display: block;
        }

        /* 焦点框：WinUI 双层焦点矩形 */
        #skj-widget button:focus-visible,
        #skj-modal button:focus-visible,
        #skj-modal .skj-switch input:focus-visible + .skj-slider {
          outline: 2px solid var(--skj-text-1);
          outline-offset: 1px;
          box-shadow: 0 0 0 1px #FFFFFF;
        }

        /* ---------------- 悬浮小窗 ---------------- */
        #skj-widget {
          position: fixed;
          display: flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 4px 0 6px;
          background: rgba(252, 252, 252, 0.86);
          -webkit-backdrop-filter: blur(30px) saturate(150%);
          backdrop-filter: blur(30px) saturate(150%);
          border: 1px solid rgba(0, 0, 0, 0.0578);
          border-radius: var(--skj-radius-lg);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12);
          cursor: move;
          user-select: none;
          transition: box-shadow 0.2s var(--skj-ease);
        }
        #skj-widget:hover {
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.16), 0 0 2px rgba(0, 0, 0, 0.14);
        }
        #skj-widget-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 13px;
          white-space: nowrap;
        }
        .skj-logo-tile {
          width: 26px;
          height: 26px;
          border-radius: var(--skj-radius);
          background: var(--skj-accent);
          color: #FFFFFF;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
        }
        .skj-logo-tile .skj-icon {
          width: 14px;
          height: 14px;
        }
        #skj-widget-status {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 24px;
          padding: 0 8px;
          font-size: 12px;
          line-height: 16px;
          color: var(--skj-text-2);
          background: rgba(0, 0, 0, 0.0373);
          border-radius: var(--skj-radius);
          max-width: 168px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #skj-widget-status::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex: none;
          background: var(--skj-dot, var(--skj-text-3));
        }
        #skj-widget-btn {
          width: 32px;
          height: 32px;
          padding: 0;
          border: none;
          border-radius: var(--skj-radius);
          background: transparent;
          color: var(--skj-text-2);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
        }
        #skj-widget-btn:hover {
          background: var(--skj-subtle-hover);
          color: var(--skj-text-1);
        }
        #skj-widget-btn:active {
          background: var(--skj-subtle-pressed);
          color: var(--skj-text-2);
        }

        /* 运行状态指示色（悬浮窗与仪表盘共用） */
        [data-skj-state="running"] { --skj-dot: var(--skj-accent); }
        [data-skj-state="done"] { --skj-dot: var(--skj-success); }
        [data-skj-state="error"] { --skj-dot: var(--skj-critical); }
        [data-skj-state="running"] #skj-widget-status::before,
        [data-skj-state="running"] .skj-status-dot {
          animation: skjPulse 1.6s ease-in-out infinite;
        }
        @keyframes skjPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }

        /* ---------------- 遮罩与对话框 ---------------- */
        #skj-modal {
          display: none;
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.3);
          align-items: center;
          justify-content: center;
        }
        #skj-modal.show {
          display: flex;
        }
        .skj-dialog {
          width: 680px;
          max-width: calc(100vw - 32px);
          max-height: min(760px, calc(100vh - 48px));
          background: var(--skj-layer);
          border: 1px solid rgba(0, 0, 0, 0.0578);
          border-radius: var(--skj-radius-lg);
          box-shadow: 0 32px 64px rgba(0, 0, 0, 0.1876), 0 2px 21px rgba(0, 0, 0, 0.1474);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: skjDialogIn 0.25s var(--skj-ease);
        }
        @keyframes skjDialogIn {
          from { opacity: 0; transform: scale(1.04); }
          to { opacity: 1; transform: scale(1); }
        }

        /* 标题栏 */
        .skj-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 16px 4px 20px;
        }
        .skj-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 20px;
          line-height: 28px;
          font-weight: 600;
          color: var(--skj-text-1);
        }
        .skj-header-title .skj-logo-tile {
          width: 28px;
          height: 28px;
        }
        .skj-badge {
          font-size: 12px;
          line-height: 16px;
          font-weight: 400;
          color: var(--skj-text-2);
          background: rgba(0, 0, 0, 0.0373);
          padding: 2px 6px;
          border-radius: var(--skj-radius);
        }
        .skj-close {
          width: 32px;
          height: 32px;
          padding: 0;
          border: none;
          border-radius: var(--skj-radius);
          background: transparent;
          color: var(--skj-text-2);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .skj-close:hover {
          background: var(--skj-subtle-hover);
          color: var(--skj-text-1);
        }
        .skj-close:active {
          background: var(--skj-subtle-pressed);
        }

        /* 顶部导航（SelectorBar） */
        .skj-tabs {
          display: flex;
          gap: 4px;
          padding: 4px 16px 0;
          border-bottom: 1px solid var(--skj-divider);
        }
        .skj-tab {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 12px;
          margin-bottom: 4px;
          border: none;
          border-radius: var(--skj-radius);
          background: transparent;
          color: var(--skj-text-2);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.1s;
        }
        .skj-tab:hover {
          background: var(--skj-subtle-hover);
          color: var(--skj-text-1);
        }
        .skj-tab:active {
          background: var(--skj-subtle-pressed);
        }
        .skj-tab.active {
          color: var(--skj-text-1);
          font-weight: 600;
        }
        .skj-tab.active .skj-icon {
          color: var(--skj-accent);
        }
        .skj-tab::after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: -4px;
          width: 16px;
          height: 3px;
          margin-left: -8px;
          border-radius: 2px;
          background: var(--skj-accent);
          transform: scaleX(0);
          transition: transform 0.2s var(--skj-ease);
        }
        .skj-tab.active::after {
          transform: scaleX(1);
        }

        /* 内容区 */
        .skj-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 16px 20px 20px;
          scrollbar-width: thin;
        }
        .skj-panel {
          display: none;
        }
        .skj-panel.active {
          display: block;
        }
        .skj-section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-height: 32px;
          margin: 20px 0 4px;
          font-weight: 600;
          color: var(--skj-text-1);
        }
        .skj-section-title:first-child {
          margin-top: 0;
        }
        .skj-note {
          margin: 8px 2px 0;
          font-size: 12px;
          line-height: 16px;
          color: var(--skj-text-2);
        }

        /* 设置卡片（SettingsCard） */
        .skj-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .skj-card {
          display: flex;
          align-items: center;
          gap: 16px;
          min-height: 68px;
          padding: 12px 16px;
          background: var(--skj-card);
          border: 1px solid var(--skj-stroke);
          border-radius: var(--skj-radius);
          transition: background 0.1s;
        }
        .skj-card:hover {
          background: var(--skj-card-hover);
        }
        .skj-card-stack {
          flex-direction: column;
          align-items: stretch;
          gap: 12px;
        }
        .skj-card-stack:hover {
          background: var(--skj-card);
        }
        .skj-card-head {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .skj-card-icon {
          color: var(--skj-text-1);
          display: flex;
          flex: none;
        }
        .skj-card-icon .skj-icon {
          width: 20px;
          height: 20px;
        }
        .skj-card-text {
          flex: 1;
          min-width: 0;
        }
        .skj-card-title {
          display: block;
          color: var(--skj-text-1);
        }
        .skj-card-desc {
          margin-top: 2px;
          font-size: 12px;
          line-height: 16px;
          color: var(--skj-text-2);
        }
        .skj-card-desc + .skj-card-desc {
          margin-top: 4px;
        }
        .skj-card-action {
          flex: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .skj-card-action .skj-input {
          width: 220px;
        }
        .skj-card-action .skj-input[type="number"] {
          width: 96px;
        }

        /* 表单字段 */
        .skj-fields {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-left: 36px;
        }
        .skj-field-label {
          display: block;
          margin-bottom: 6px;
          color: var(--skj-text-1);
        }
        .skj-field .skj-card-desc {
          margin-top: 4px;
        }

        /* 文本框 / 下拉框（TextBox / ComboBox） */
        .skj-input {
          display: block;
          width: 100%;
          height: 32px;
          padding: 5px 11px;
          font-size: 14px;
          line-height: 20px;
          color: var(--skj-text-1);
          background: var(--skj-control);
          border: 1px solid var(--skj-stroke);
          border-bottom-color: var(--skj-stroke-input);
          border-radius: var(--skj-radius);
          outline: none;
          box-shadow: none;
          transition: background 0.1s;
        }
        .skj-input::placeholder {
          color: var(--skj-text-3);
        }
        .skj-input:hover {
          background: var(--skj-control-hover);
        }
        .skj-input:focus {
          background: #FFFFFF;
          border-bottom-color: var(--skj-accent);
          box-shadow: inset 0 -1px 0 var(--skj-accent);
        }
        .skj-input:disabled {
          color: var(--skj-text-disabled);
          background: rgba(249, 249, 249, 0.3);
          border-color: var(--skj-stroke);
          cursor: not-allowed;
        }
        select.skj-input {
          -webkit-appearance: none;
          appearance: none;
          padding-right: 34px;
          cursor: pointer;
          border-bottom-color: var(--skj-stroke-bottom);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%235D5D5D' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 11px center;
        }
        select.skj-input:focus {
          border-bottom-color: var(--skj-stroke-bottom);
          box-shadow: none;
          background-color: var(--skj-control-hover);
        }

        /* 开关（ToggleSwitch） */
        .skj-switch {
          position: relative;
          display: inline-block;
          width: 40px;
          height: 20px;
          flex: none;
        }
        .skj-switch input {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
          margin: 0;
        }
        .skj-slider {
          position: absolute;
          inset: 0;
          cursor: pointer;
          background: rgba(0, 0, 0, 0.0241);
          border: 1px solid rgba(0, 0, 0, 0.6063);
          border-radius: 10px;
          transition: background 0.15s, border-color 0.15s;
        }
        .skj-slider::before {
          content: "";
          position: absolute;
          top: 50%;
          left: 3px;
          width: 12px;
          height: 12px;
          margin-top: -6px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.6063);
          transition: transform 0.2s var(--skj-ease), width 0.15s, height 0.15s, margin 0.15s, background 0.15s;
        }
        .skj-switch:hover .skj-slider {
          background: rgba(0, 0, 0, 0.0578);
        }
        .skj-switch:hover .skj-slider::before {
          width: 14px;
          height: 14px;
          margin-top: -7px;
        }
        .skj-switch:active .skj-slider::before {
          width: 17px;
        }
        .skj-switch input:checked + .skj-slider {
          background: var(--skj-accent);
          border-color: var(--skj-accent);
        }
        .skj-switch input:checked + .skj-slider::before {
          background: #FFFFFF;
          transform: translateX(20px);
        }
        .skj-switch:hover input:checked + .skj-slider {
          background: var(--skj-accent-hover);
          border-color: var(--skj-accent-hover);
        }
        .skj-switch:hover input:checked + .skj-slider::before {
          transform: translateX(18px);
        }
        .skj-switch:active input:checked + .skj-slider::before {
          transform: translateX(15px);
        }

        /* 按钮（Button / AccentButton / SubtleButton） */
        .skj-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 32px;
          padding: 0 12px;
          font-size: 14px;
          line-height: 20px;
          font-weight: 400;
          white-space: nowrap;
          cursor: pointer;
          border-radius: var(--skj-radius);
          border: 1px solid var(--skj-stroke);
          border-bottom-color: var(--skj-stroke-bottom);
          background: var(--skj-control);
          color: var(--skj-text-1);
          transition: background 0.1s, color 0.1s;
        }
        .skj-btn:hover {
          background: var(--skj-control-hover);
        }
        .skj-btn:active {
          background: var(--skj-control-pressed);
          color: var(--skj-text-2);
          border-bottom-color: var(--skj-stroke);
        }
        .skj-btn-primary {
          background: var(--skj-accent);
          color: #FFFFFF;
          border-color: rgba(255, 255, 255, 0.08);
          border-bottom-color: rgba(0, 0, 0, 0.4);
        }
        .skj-btn-primary:hover {
          background: var(--skj-accent-hover);
        }
        .skj-btn-primary:active {
          background: var(--skj-accent-pressed);
          color: rgba(255, 255, 255, 0.8);
          border-color: transparent;
        }
        .skj-btn-subtle {
          background: transparent;
          border-color: transparent;
          color: var(--skj-text-1);
        }
        .skj-btn-subtle:hover {
          background: var(--skj-subtle-hover);
        }
        .skj-btn-subtle:active {
          background: var(--skj-subtle-pressed);
          border-color: transparent;
        }
        .skj-btn-sm {
          height: 28px;
          padding: 0 8px;
          font-size: 13px;
        }

        /* 仪表盘 */
        .skj-status-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: var(--skj-card);
          border: 1px solid var(--skj-stroke);
          border-radius: var(--skj-radius-lg);
        }
        .skj-status-icon {
          position: relative;
          width: 44px;
          height: 44px;
          flex: none;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--skj-radius-lg);
          background: var(--skj-accent-subtle);
          color: var(--skj-accent);
        }
        .skj-status-icon .skj-icon {
          width: 22px;
          height: 22px;
        }
        .skj-status-dot {
          position: absolute;
          right: -2px;
          bottom: -2px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid var(--skj-card);
          background: var(--skj-dot, var(--skj-text-3));
        }
        .skj-status-label {
          font-size: 12px;
          line-height: 16px;
          color: var(--skj-text-2);
        }
        .skj-status-text {
          margin-top: 2px;
          font-size: 16px;
          line-height: 22px;
          font-weight: 600;
          color: var(--skj-text-1);
          word-break: break-all;
        }
        .skj-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        .skj-actions .skj-btn {
          flex: 1;
          height: 36px;
        }

        /* 运行日志 */
        .skj-console {
          height: 220px;
          overflow-y: auto;
          padding: 8px 0;
          background: #FFFFFF;
          border: 1px solid var(--skj-stroke);
          border-radius: var(--skj-radius);
          font-family: "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, "Microsoft YaHei UI", monospace;
          font-size: 12px;
          line-height: 18px;
          scrollbar-width: thin;
        }
        .skj-console:empty::before {
          content: "暂无日志";
          display: block;
          padding: 4px 12px;
          color: var(--skj-text-3);
          font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif;
        }
        .skj-log-item {
          display: flex;
          gap: 10px;
          padding: 1px 12px;
          color: var(--skj-text-1);
          word-break: break-all;
        }
        .skj-log-item:hover {
          background: rgba(0, 0, 0, 0.024);
        }
        .skj-log-time {
          flex: none;
          color: var(--skj-text-3);
        }
        .skj-log-item.warn { color: var(--skj-caution); }
        .skj-log-item.error {
          color: var(--skj-critical);
          background: rgba(196, 43, 28, 0.05);
        }

        /* 提示条（InfoBar） */
        .skj-alert {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-top: 4px;
          padding: 12px 16px;
          font-size: 13px;
          line-height: 20px;
          color: var(--skj-text-1);
          background: var(--skj-caution-bg);
          border: 1px solid var(--skj-stroke);
          border-radius: var(--skj-radius);
        }
        .skj-alert-icon {
          width: 16px;
          height: 16px;
          margin-top: 2px;
          flex: none;
          border-radius: 50%;
          background: var(--skj-caution);
          color: #FFFFFF;
          font-size: 11px;
          line-height: 16px;
          font-weight: 700;
          text-align: center;
        }

        /* 底部命令栏 */
        .skj-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 64px;
          padding: 12px 20px;
          background: #FAFAFA;
          border-top: 1px solid var(--skj-divider);
        }
        .skj-footer-status {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: 12px;
          line-height: 16px;
          color: var(--skj-text-2);
        }
        .skj-footer-status span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .skj-tip-success {
          color: var(--skj-success);
          font-weight: 600;
        }
        .skj-footer-actions {
          display: flex;
          gap: 8px;
          flex: none;
        }

        @media (max-width: 560px) {
          .skj-tab span { display: none; }
          .skj-card, .skj-card-head { flex-wrap: wrap; }
          .skj-card-action .skj-input { width: 100%; }
          .skj-card-action { width: 100%; }
          .skj-fields { padding-left: 0; }
          .skj-footer { flex-wrap: wrap; }
        }
        @media (prefers-reduced-motion: reduce) {
          #skj-widget, #skj-modal, #skj-widget *, #skj-modal * {
            animation: none !important;
            transition: none !important;
          }
        }
`;
