/* =========================================================================
 * 控制面板样式表
 * ========================================================================= */
const UI_STYLES = `
        /* 刷客酱主容器与字体 */
        #skj-widget, #skj-modal {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: #1f2937;
          box-sizing: border-box;
          z-index: 2147483640;
        }
        #skj-widget *, #skj-modal * {
          box-sizing: border-box;
        }

        /* 悬浮小胶囊球 */
        #skj-widget {
          position: fixed;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: #ffffff;
          border-radius: 9999px;
          box-shadow: 0 4px 14px rgba(29, 78, 216, 0.35);
          cursor: move;
          user-select: none;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        #skj-widget:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(29, 78, 216, 0.45);
        }
        #skj-widget-logo {
          font-weight: 700;
          font-size: 15px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        #skj-widget-status {
          font-size: 12px;
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          max-width: 140px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #skj-widget-btn {
          cursor: pointer;
          background: none;
          border: none;
          color: #ffffff;
          font-size: 14px;
          display: flex;
          align-items: center;
          padding: 2px;
        }

        /* 模态弹窗遮罩 */
        #skj-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(2px);
          align-items: center;
          justify-content: center;
        }
        #skj-modal.show {
          display: flex;
        }

        /* 模态弹窗主体 */
        .skj-dialog {
          width: 580px;
          max-width: 92vw;
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 85vh;
          animation: skjFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes skjFadeIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }

        /* 弹窗头部 */
        .skj-header {
          padding: 16px 20px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .skj-header-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .skj-badge {
          font-size: 11px;
          font-weight: 600;
          color: #2563eb;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          padding: 2px 6px;
          border-radius: 6px;
        }
        .skj-close {
          background: none;
          border: none;
          font-size: 20px;
          color: #64748b;
          cursor: pointer;
          border-radius: 6px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .skj-close:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        /* 标签导航栏 */
        .skj-tabs {
          display: flex;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }
        .skj-tab {
          flex: 1;
          padding: 12px;
          text-align: center;
          font-weight: 600;
          color: #64748b;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
        }
        .skj-tab.active {
          color: #2563eb;
          border-bottom-color: #2563eb;
          background: #f8fafc;
        }

        /* 内容区 */
        .skj-body {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
        }
        .skj-panel {
          display: none;
        }
        .skj-panel.active {
          display: block;
        }

        /* 弹窗底部操作栏 */
        .skj-footer {
          padding: 12px 20px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .skj-footer-status {
          font-size: 12px;
          color: #10b981;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* 表单控件 */
        .skj-form-item {
          margin-bottom: 16px;
        }
        .skj-form-label {
          display: flex;
          justify-content: space-between;
          font-weight: 600;
          font-size: 13px;
          color: #334155;
          margin-bottom: 6px;
        }
        .skj-form-desc {
          font-size: 12px;
          color: #64748b;
          margin-top: 4px;
        }
        .skj-input {
          width: 100%;
          padding: 9px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .skj-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        /* 开关切换 Switch */
        .skj-switch-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid #f1f5f9;
        }
        .skj-switch-text {
          font-weight: 600;
          color: #1e293b;
        }
        .skj-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .skj-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .skj-slider {
          position: absolute;
          cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: #cbd5e1;
          transition: 0.3s;
          border-radius: 24px;
        }
        .skj-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .skj-switch input:checked + .skj-slider {
          background-color: #2563eb;
        }
        .skj-switch input:checked + .skj-slider:before {
          transform: translateX(20px);
        }

        /* 状态卡片与控制台日志 */
        .skj-status-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .skj-status-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          background: #10b981;
          border-radius: 50%;
          margin-right: 6px;
        }
        .skj-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
        }
        .skj-btn {
          flex: 1;
          padding: 10px 14px;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .skj-btn-primary {
          background: #2563eb;
          color: #ffffff;
        }
        .skj-btn-primary:hover {
          background: #1d4ed8;
        }
        .skj-btn-secondary {
          background: #e2e8f0;
          color: #334155;
        }
        .skj-btn-secondary:hover {
          background: #cbd5e1;
        }
        .skj-btn-danger {
          background: #ef4444;
          color: #ffffff;
        }

        /* 日志窗口 */
        .skj-console {
          height: 170px;
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 10px;
          padding: 10px;
          font-family: Consolas, Monaco, monospace;
          font-size: 12px;
          overflow-y: auto;
          line-height: 1.6;
        }
        .skj-log-item {
          word-break: break-all;
        }
        .skj-log-item.error { color: #f87171; }
        .skj-log-item.warn { color: #facc15; }

        /* 警告小注 */
        .skj-alert {
          background: #fffbeb;
          border: 1px solid #fef3c7;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 12px;
          color: #b45309;
          margin-top: 10px;
          display: flex;
          gap: 6px;
        }
`;
