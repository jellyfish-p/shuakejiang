// Release gate shared by branch CI and tag CD. No network or write operations.
const fs = require('fs');
const path = require('path');

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function metadataVersion(content, label) {
  if (typeof content !== 'string') throw new Error(`${label} 缺少脚本文本`);
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // Vendored libraries may contain their own UserScript headers. Only the leading
  // public metadata block belongs to this userscript.
  const header = normalized.match(/^\s*\/\/ ==UserScript==\n([\s\S]*?)^\/\/ ==\/UserScript==/m);
  if (!header || normalized.slice(0, header.index).trim()) throw new Error(`${label} 缺少开头的 UserScript 元数据`);
  const versions = Array.from(header[1].matchAll(/^\/\/[ \t]+@version[ \t]+([^\s]+)[ \t]*$/gm), match => match[1]);
  if (versions.length !== 1) throw new Error(`${label} 必须且只能包含一个 @version`);
  return versions[0];
}

function checkReleaseVersion({ packageVersion, header, userscript, tag = '' }) {
  if (typeof packageVersion !== 'string' || packageVersion !== packageVersion.trim() || !STABLE_VERSION.test(packageVersion)) {
    throw new Error('package.json.version 必须是无前导零的 X.Y.Z 正式版本');
  }
  if (typeof tag !== 'string') throw new Error('版本标签必须是字符串');
  if (tag && (tag !== tag.trim() || !tag.startsWith('v') || !STABLE_VERSION.test(tag.slice(1)))) {
    throw new Error('自动发版仅支持 vX.Y.Z 正式版本标签');
  }
  const headerVersion = metadataVersion(header, 'src/header.js');
  const builtVersion = metadataVersion(userscript, 'shuakejiang.user.js');
  if (headerVersion !== packageVersion || builtVersion !== packageVersion) {
    throw new Error(`版本不一致：package=${packageVersion}, header=${headerVersion}, userscript=${builtVersion}`);
  }
  if (tag && tag !== `v${packageVersion}`) {
    throw new Error(`标签 ${tag} 与当前版本 v${packageVersion} 不一致`);
  }
  return packageVersion;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = checkReleaseVersion({
      packageVersion: pkg.version,
      header: fs.readFileSync(path.join(root, 'src/header.js'), 'utf8'),
      userscript: fs.readFileSync(process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'shuakejiang.user.js'), 'utf8'),
      tag: process.argv[2] || ''
    });
    console.log(`✅ 版本校验通过：v${version}${process.argv[2] ? '（标签匹配）' : '（仅 CI 校验，不发布）'}`);
  } catch (error) {
    console.error('❌ ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkReleaseVersion };
