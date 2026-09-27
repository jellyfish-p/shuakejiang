/* =========================================================================
 * 4. 平台与页面特征检测
 * ========================================================================= */
const Site = {
  isChaoxing: /chaoxing\.com|xuexitong\.com/.test(location.hostname),
  isZhihuishu: /zhihuishu\.com/.test(location.hostname),
  isIcve: /icve\.com\.cn/.test(location.hostname),
  isMooc: /icourse163\.org/.test(location.hostname),
  isXuetang: /xuetangx\.com/.test(location.hostname),

  // 超星学习任务页
  isCxStudentStudy: /studentstudy/.test(location.href),
  // 超星作业/考试独立页面
  isCxWorkOrExam: /dowork|doHomeWork|reVersionPaperMarkContent|reVersionTestStartNew/.test(location.href),
  // 智慧树视频学习页
  isZhsStudy: /stuStudy|fusioncourseh5|point/.test(location.href),
  // 智慧树作业/考试
  isZhsExam: /stuExamWeb|ReviewExam|dohomework/.test(location.href)
};
