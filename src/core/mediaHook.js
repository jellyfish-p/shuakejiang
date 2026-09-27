/* =========================================================================
 * 0. 全局环境与反检测倍速 HOOK (必须在 document-start 最先执行)
 * ========================================================================= */
try {
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const origAddEventListener = win.HTMLMediaElement.prototype.addEventListener;
  win.HTMLMediaElement.prototype.addEventListener = function (type, listener, options) {
    // 屏蔽播放器自身绑定的倍速变动与进度拖动检测事件，防止被强制重置倍速或暂停
    if (type === 'ratechange' || type === 'seeked' || type === 'seeking') {
      return;
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  Object.defineProperty(win.HTMLMediaElement.prototype, 'onratechange', {
    configurable: true,
    enumerable: true,
    get: () => null,
    set: () => {}
  });
  Object.defineProperty(win.HTMLMediaElement.prototype, 'onseeked', {
    configurable: true,
    enumerable: true,
    get: () => null,
    set: () => {}
  });
  Object.defineProperty(win.HTMLMediaElement.prototype, 'onseeking', {
    configurable: true,
    enumerable: true,
    get: () => null,
    set: () => {}
  });
} catch (e) {
  console.warn('[刷客酱] HOOK HTMLMediaElement 失败:', e);
}
