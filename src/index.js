/* =========================================================================
 * 8. 主程序引导与初始化
 *    说明：用户脚本在每一层框架中都会执行，这里采用“顶层编排 + 子框架协助”的模式：
 *    - 顶层框架：创建控制面板，并编排整条学习流水线（超星任务点队列 / 智慧树小节推进）
 *    - 同源子框架：由顶层通过 contentDocument 递归访问，无需自行跳转
 *    - 跨域子框架：只负责本框架内的媒体接管，播放完成后向顶层广播事件
 * ========================================================================= */
function main() {
  const videoAssist = new VideoAssistant();
  const examAssist = new ExamAssistant(videoAssist);
  videoAssist.setExamAssistant(examAssist);

  const isTop = skjIsTopFrame();

  // 1. 初始化浮窗界面（仅顶层框架）
  if (isTop) {
    const ui = new UIController(videoAssist, examAssist);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ui.init());
    } else {
      ui.init();
    }
  }

  // 2. 启动学习流水线（每帧都启动，由内部自行判定职责）
  videoAssist.start();

  // 3. 页面加载完成后按站点自动进入答题流程（仅顶层，避免多个实例重复触发）
  if (isTop) {
    window.addEventListener('load', () => {
      const cfg = getConfig();

      // 3.1 独立作业 / 考试页面：延时自动作答
      if (cfg.examEnabled && (Site.isCxWorkOrExam || Site.isZhsExam)) {
        setTimeout(() => {
          examAssist.solveCurrentPage(false);
        }, 3000);
        return;
      }

      // 3.2 超星学习任务页：重新识别任务点（含首屏即为测验的情况）
      if (Site.isCxStudentStudy) {
        setTimeout(() => {
          videoAssist.kick();
        }, 2500);
      }
    });
  }

  console.log('[刷课酱] 网课视频助手与 AI 解题助手启动就绪！');
}

main();
