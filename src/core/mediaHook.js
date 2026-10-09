/* =========================================================================
 * 0. 全局环境与反检测倍速 HOOK (必须在 document-start 最先执行)
 * ========================================================================= */

/**
 * 为指定 window 注入媒体元素反检测 Hook
 * 确保能够跨 iframe 穿透并彻底解除超星等网课平台的倍速检测与强制暂停限制
 */
function hookMediaWindow(win) {
  if (!win) return;
  try {
    if (win._skj_media_hooked) return;
    win._skj_media_hooked = true;

    const proto = win.HTMLMediaElement?.prototype;
    if (!proto) return;

    // 1. 屏蔽网页播放器监听倍速变动与进度拖动检测
    const origAdd = proto.addEventListener;
    proto.addEventListener = function (type, listener, options) {
      // 拦截 ratechange、seeked、seeking，防止超星等脚本捕获倍速变动后强行重置或暂停
      if (type === 'ratechange' || type === 'seeked' || type === 'seeking') {
        return;
      }
      return origAdd.call(this, type, listener, options);
    };

    // 2. 劫持 playbackRate 属性描述符 (实现倍速伪装与防篡改)
    const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
    if (origDesc) {
      win._skj_native_rate_desc = origDesc;
      Object.defineProperty(proto, 'playbackRate', {
        configurable: true,
        enumerable: true,
        get: function () {
          // 外部或超星检测代码读取时，伪装返回 1.0 (防止超星检测到倍速异常强制暂停或重置)
          if (this._skj_setting_real_rate) {
            return origDesc.get.call(this);
          }
          return 1.0;
        },
        set: function (val) {
          // 仅允许刷课酱内部设置真实底层播放倍速
          if (this._skj_setting_real_rate) {
            origDesc.set.call(this, val);
            this._skj_real_rate = val;
          } else {
            // 拦截并丢弃外部脚本尝试强制重置倍速为 1 的操作
          }
        }
      });
    }

    // 3. 屏蔽 onratechange, onseeked, onseeking 属性赋值
    ['onratechange', 'onseeked', 'onseeking'].forEach((prop) => {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: true,
        get: () => null,
        set: () => {}
      });
    });
  } catch (e) {
    console.warn('[刷课酱] HOOK HTMLMediaElement 失败:', e);
  }
}

// 立即在当前窗口执行 (document-start)
const rootWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
hookMediaWindow(rootWin);
