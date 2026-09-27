/**
 * 刷客酱 - 自动化构建脚本 (Zero-Dependency Bundler)
 * 将 src/ 目录下的模块组装打包为单一的油猴用户脚本 shuakejiang.user.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const OUTPUT_FILE = path.join(ROOT_DIR, 'shuakejiang.user.js');

const MODULE_FILES = [
  'core/mediaHook.js',
  'config.js',
  'core/state.js',
  'api/openai.js',
  'modules/exam/parser.js',
  'core/site.js',
  'modules/video/videoAssistant.js',
  'modules/exam/examAssistant.js',
  'ui/styles.js',
  'ui/uiController.js',
  'index.js'
];

function build() {
  const startTime = Date.now();
  console.log('[Build] 正在打包用户脚本...');

  // 1. 读取 Userscript 元数据头
  const headerPath = path.join(SRC_DIR, 'header.js');
  if (!fs.existsSync(headerPath)) {
    throw new Error(`找不到元数据头文件: ${headerPath}`);
  }
  const headerContent = fs.readFileSync(headerPath, 'utf-8').trim();

  // 2. 依次读取各个子模块并进行 2 空格内嵌缩进
  const moduleBlocks = [];
  for (const relPath of MODULE_FILES) {
    const fullPath = path.join(SRC_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`找不到子模块文件: ${fullPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf-8').trim();
    // 为模块内代码添加缩进
    const indented = content
      .split('\n')
      .map((line) => (line.trim().length > 0 ? '  ' + line : ''))
      .join('\n');
    moduleBlocks.push(indented);
  }

  // 3. 组装为 IIFE 闭包
  const outputCode = `${headerContent}

(function () {
  'use strict';

${moduleBlocks.join('\n\n')}
})();
`;

  // 4. 严格语法检查 (避免语法错误产物生成)
  try {
    new vm.Script(outputCode, { filename: 'shuakejiang.user.js' });
  } catch (err) {
    console.error('[Build] ❌ 语法校验失败:', err.message);
    throw err;
  }

  // 5. 写入目标产物文件
  fs.writeFileSync(OUTPUT_FILE, outputCode, 'utf-8');

  const duration = Date.now() - startTime;
  const stats = fs.statSync(OUTPUT_FILE);
  const lineCount = outputCode.split('\n').length;
  const kbSize = (stats.size / 1024).toFixed(2);

  console.log(`[Build] ✅ 打包成功: ${OUTPUT_FILE}`);
  console.log(`[Build] 📊 大小: ${kbSize} KB | 行数: ${lineCount} 行 | 耗时: ${duration} ms\n`);
}

// 支持 --watch 监听模式
if (process.argv.includes('--watch')) {
  build();
  console.log('[Watch] 正在监听 src/ 目录变更...');
  let debounceTimer = null;
  fs.watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`[Watch] 检测到文件变更: ${filename}，重新打包中...`);
      try {
        build();
      } catch (e) {
        console.error('[Watch] 打包出错:', e.message);
      }
    }, 200);
  });
} else {
  build();
}

module.exports = { build, OUTPUT_FILE };
