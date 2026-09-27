/* =========================================================================
 * 8. 主程序引导与初始化
 * ========================================================================= */
function main() {
  const videoAssist = new VideoAssistant();
  const examAssist = new ExamAssistant(videoAssist);
  videoAssist.setExamAssistant(examAssist);
  const ui = new UIController(videoAssist, examAssist);

  // 1. 初始化界面 (仅在顶层窗口运行)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ui.init();
    });
  } else {
    ui.init();
  }

  // 2. 启动视频监控服务
  videoAssist.start();

  // 3. 页面加载完成后，若为独立作业/考试页面且开启了自动答题，则延时自动触发
  window.addEventListener('load', () => {
    const cfg = getConfig();
    if (cfg.examEnabled) {
      if (Site.isCxWorkOrExam || Site.isZhsExam) {
        setTimeout(() => {
          examAssist.solveCurrentPage(false);
        }, 3000);
      } else if (Site.isCxStudentStudy) {
        // 超星学习任务页：延迟检测首屏是否直接是章节测验
        setTimeout(() => {
          videoAssist.checkAndSolveChapterQuiz(cfg);
        }, 3500);
      }
    }
  });

  console.log('[刷客酱] 网课助手与 AI 解题助手启动就绪！');
}

main();
