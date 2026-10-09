/* =========================================================================
 * 4.6 超星课程目录导航
 *     读取页面已渲染的 #coursetree：
 *     - #_studystate.value 提供平台计算的 nextChapterId
 *     - #cur<chapterId> 节点提供原生 getTeacherAjax onclick
 *     - 未完成任务点由 .jobUnfinishCount / .orangeNew > 0 标识
 * ========================================================================= */

class CxCatalogNavigator {
  constructor() {
    this.jumpLock = 0;
  }

  catalog() {
    try {
      return document.getElementById('coursetree');
    } catch (e) {
      return null;
    }
  }

  parseId(value) {
    const match = String(value || '').match(/(\d+)/);
    return match ? match[1] : '';
  }

  currentChapterId(scope = this.catalog()) {
    try {
      const active = scope?.querySelector('.posCatalog_active[id^="cur"]');
      if (active) return this.parseId(active.id);
    } catch (e) {}
    try {
      const urls = [location.href];
      const route = CxDom.routeInfo();
      if (route?.mainDocumentHref) urls.push(route.mainDocumentHref);
      for (const href of urls) {
        const id = new URL(href, location.href).searchParams.get('chapterId');
        if (id) return this.parseId(id);
      }
    } catch (e) {}
    return '';
  }

  readState() {
    const scope = this.catalog();
    if (!scope) return null;
    const state = {
      currentChapterId: this.currentChapterId(scope),
      nextChapterId: '',
      unfinishCount: 0,
      entries: []
    };
    try {
      const marker = scope.querySelector('#_studystate');
      const raw = marker?.value || marker?.getAttribute('value') || '';
      const next = String(raw).match(/nextChapterId\s*:\s*['"]?(\d+)/i);
      const count = String(raw).match(/unfinishCount\s*:\s*['"]?(\d+)/i);
      state.nextChapterId = next ? next[1] : '';
      state.unfinishCount = count ? Math.max(0, Number(count[1]) || 0) : 0;

      state.entries = Array.from(scope.querySelectorAll('.posCatalog_select[id^="cur"]'))
        .map((node, order) => {
          const id = this.parseId(node.id);
          if (!id) return null;
          const completed = !!node.querySelector('.icon_Completed, .ans-job-finished');
          const pending = Array.from(node.querySelectorAll('.jobUnfinishCount, .orangeNew'))
            .map((el) => Number.parseInt(String(el.value ?? el.innerText ?? el.textContent ?? ''), 10) || 0)
            .reduce((sum, value) => sum + value, 0);
          return { id, order, completed, unfinished: !completed && pending > 0 };
        })
        .filter(Boolean);
    } catch (e) {}
    return state;
  }

  chooseTarget(state) {
    if (!state) return '';
    const current = state.currentChapterId;
    const pending = state.entries.filter((entry) => entry.unfinished && !entry.completed);
    const platformTarget = this.parseId(state.nextChapterId);
    if (platformTarget && platformTarget !== current && (state.unfinishCount > 0 || pending.length)) {
      return platformTarget;
    }

    if (!pending.length) return '';
    const currentEntry = state.entries.find((entry) => entry.id === current);
    const next = currentEntry
      ? pending.find((entry) => entry.order > currentEntry.order)
      : null;
    // 允许补漏：后续没有待完成章节时，从目录头部寻找首个待完成章节。
    return next?.id || pending[0].id;
  }

  findNode(chapterId, scope = this.catalog()) {
    const id = this.parseId(chapterId);
    if (!id || !scope) return null;
    try {
      return scope.querySelector(`#cur${id}`) || scope.querySelector(`[id="cur${id}"]`);
    } catch (e) {
      return null;
    }
  }

  /**
   * 在当前章节任务点排空后调用。
   * 返回 navigating / none / paused，供 CxCourseRunner 决定是否继续旧的下一节逻辑。
   */
  navigate(config) {
    if (!config?.autoNext || !config.skipFinished || Date.now() < this.jumpLock) return 'none';
    const state = this.readState();
    const targetId = this.chooseTarget(state);
    if (!targetId || targetId === state?.currentChapterId) return 'none';

    const node = this.findNode(targetId);
    if (!node) return 'none';
    const link = node.querySelector('.posCatalog_name[onclick], .posCatalog_name, [onclick]') || node;
    try {
      AppState.log(`检测到下一个未完成章节，正在跳转：${targetId}`);
      skjHumanClick(link);
      this.jumpLock = Date.now() + 6000;
      return 'navigating';
    } catch (e) {
      AppState.log(`超星目录跳转失败：${e.message || e}`, 'warn');
      return 'none';
    }
  }
}
