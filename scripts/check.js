/**
 * 刷课酱 - 质量与一致性检查脚本 (CI Test)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const USERSCRIPT_PATH = path.join(ROOT_DIR, 'shuakejiang.user.js');

console.log('[Test] 开始检验产物 shuakejiang.user.js ...');

// 1. 验证产物文件是否存在
if (!fs.existsSync(USERSCRIPT_PATH)) {
  console.error('❌ 产物文件不存在: ' + USERSCRIPT_PATH);
  process.exit(1);
}

const content = fs.readFileSync(USERSCRIPT_PATH, 'utf-8');

// 2. 验证油猴 Header
const headerRegex = /^\/\/ ==UserScript==[\s\S]+?\/\/ ==\/UserScript==/m;
if (!headerRegex.test(content)) {
  console.error('❌ 未找到合法的 // ==UserScript== 元数据头！');
  process.exit(1);
}

// 3. 验证关键元数据字段
const requiredTags = [
  '@name',
  '@version',
  '@description',
  '@author',
  '@updateURL',
  '@downloadURL',
  '@match',
  '@run-at',
  '@grant'
];

for (const tag of requiredTags) {
  if (!content.includes(tag)) {
    console.error(`❌ 元数据缺少必要标签: ${tag}`);
    process.exit(1);
  }
}

// 4. JavaScript 严格语法校验
try {
  new vm.Script(content, { filename: 'shuakejiang.user.js' });
  console.log('✅ JavaScript 语法与 AST 检查通过！');
} catch (e) {
  console.error('❌ JavaScript 语法错误:', e.message);
  process.exit(1);
}

// 5. 校验核心类和关键入口存在
const requiredIdentifiers = [
  'Storage',
  'DEFAULT_CONFIG',
  'getConfig',
  'setConfig',
  'AppState',
  'requestOpenAI',
  'Site',
  'VideoAssistant',
  'ExamAssistant',
  'UIController',
  'main'
];

for (const id of requiredIdentifiers) {
  if (!content.includes(id)) {
    console.error(`❌ 代码缺少核心组件/标识符: ${id}`);
    process.exit(1);
  }
}

console.log('✅ 所有质量校验测试通过！');
