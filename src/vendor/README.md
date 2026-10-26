# 超星字体本地查表依赖

仅迁出已标识 MIT 的映射表和独立开源字体库；**不代表原扩展整体或其业务代码采用 MIT**。没有复制 Parcel 模块加载器、页面处理逻辑或扩展 API。已由 `scripts/build.js` 内置到油猴产物；构建和运行均不需要被 Git 忽略的原插件快照。

## 接口与使用约束

将两个 `.js` 文件直接拼入生成 userscript 的同一个 strict IIFE，在调用方之前加载：

- `CX_FONT_TABLE`：冻结的平铺对象，**20,902 个指纹映射 + 4 个元数据字段**，共 20,906 个自有键。表版本 `20220515.1`，作者 `wyn665817`，namespace `wyn665817@163.com`，license `MIT`。
- `CX_FONT_LIB`：词法常量，浅冻结的 `{ Typr, md5 }`。通过 `CX_FONT_LIB.Typr.parse`、`.Typr.U.codeToGlyph`、`.Typr.U.glyphToPath` 和 `.md5` 使用。Typr 内部对象未深度冻结，保留上游缓存/可选功能的行为。
- 不提供 CommonJS/AMD 导出，不读写 `window.Typr` / `window.md5`，不向宿主全局对象添加属性。两个常量只在拼接后的词法作用域内可见。
- `window` 仍须存在；原样保留 `Typr.B` 对 `window.TextDecoder` 的检测。没有 `TextDecoder` 时采用上游 ASCII 回退，不宣称这是完整 UTF-8 解码。
- 指纹按固定版本产生的路径对象计算：`md5(JSON.stringify(path)).slice(24)`。直接以该 **8 位字符串**查表，不要 `parseInt`、十六进制数值化或去掉前导零。原 literal 的数值键、标识符键、带引号键和指数形式数值均原样保留；其中有 **1,300 个前导零键**、449 个数值键 token。迭代映射时排除四个元数据字段。
- 初始化没有联网行为。上游可选 `Typr.U.initHB` 仍含显式调用时使用的 `fetch`/WASM 功能，未删除或调用；本地字形查表不需要它。SVG 等可选功能仍保留原浏览器依赖，未改写为通用 Node 库。
- 两个 JS 文件内均保留相应许可告知，构建/压缩时不要剥离；同时保留 `LICENSES.txt` 的出处与限制说明。

## 来源与 SHA256

SHA256 均针对 UTF-8 文件的原始字节，不先归一化换行。下列归档仅作为读取来源，未执行或修改。

| 内容 | 来源 | 字节数 | SHA256 |
| --- | --- | ---: | --- |
| 字体库组合文件（头部版本 1.0） | `reference/original-extension/1.17.4/extracted/lib/TyprMd5.js` | 39042 | `04c4a84aacb9da4df12ba40b9d4ad515bafe6d30e4627438636edb670b755795` |
| 映射表所在 bundle | `reference/original-extension/1.17.4/beautified/SideBar.js` | 14571694 | `0f0c8bbcdc720241551f3a0e1a2b5992d711c6e473ce44c2c9119f886a33b23e` |
| 原始映射对象 literal | 模块 `3ErB5`；从第 172842 行 `let a = ` 后的 `{` 到第 193749 行的 `}`，含内部空白、不含末尾换行 | 506292 | `bf3673f83e7f62827f5590560ca9881bfd24e880f31579c57312609980e80f45` |
| 本地映射文件 | `src/vendor/cxFontTable.js` | 508177 | `6e2dfbc9890ee0d0f7b185c224430871e8c3a7d239adc9a5f90db3a482a26140` |
| 本地字体库文件 | `src/vendor/typrMd5.js` | 41910 | `3226a29c48254cfcb017080e6ced22c29dbce93f60dd2b14db48726ef276b36b` |

组合库头部指定的组件版本（不是最新版）：

- Typr parser：`photopea/Typr.js@15aa12ffa6cf39e8788562ea4af65b42317375fb/src/Typr.min.js`。
- Typr.U：`photopea/Typr.js@f4fcdeb8014edc75ab7296bd85ac9cde8cb30489/src/Typr.U.min.js`。
- MD5：`blueimp-md5@2.19.0/js/md5.min.js`。

原头部的完整 jsDelivr URL 和两个固定 commit 均保留在 `typrMd5.js`。未重新压缩、升级或替换这些组件；字形路径及其 JSON 序列化结果参与指纹，不能随意升级算法。

## 唯一的源码封装改动

`cxFontTable.js` 只在原对象外加注释、`const CX_FONT_TABLE = Object.freeze(` 和 `);`。保留对象内部字节、键语义和四个元数据字段，不执行原模块的导出代码。

`typrMd5.js` 保留原头部、压缩代码和已有 CRLF；新增注释/包装使用 LF，因此文件中存在混合换行。仅有以下改动：

1. 在原 `var Typr=...` 前开启局部 strict 函数，用 `const CX_FONT_LIB` 接收返回值。
2. 局部 `const define = undefined`、`const module = undefined` 屏蔽页面 AMD/CommonJS；`const scope = Object.create(null)` 接收 MD5 导出。
3. MD5 UMD 唯一的末尾调用 `}(this);` 改为 `}(scope);`，避免 strict IIFE 中的 `this` 为 `undefined`，也避免写宿主对象。
4. 返回 `Object.freeze({ Typr, md5: scope.md5 })`。没有 parser、路径或 MD5 算法改动。
5. 去除归档末尾的远程 `//# sourceMappingURL=...` 注释，避免开发工具查找不适用于包装后源码的远程 source map。

## 许可核实与未决项

`LICENSES.txt` 保存完整文本及固定版本 URL、SHA256：

- Photopea：两个指定 commit 的 `LICENSE` 均已获取、内容相同，MIT，原告知 `Copyright (c) 2016 Photopea`。也与研究缓存 `Typr-LICENSE` 一致。
- blueimp-md5 2.19.0：已获取该 npm 版本的完整 `LICENSE.txt`，MIT，原告知 `Copyright © 2011 Sebastian Tschan, https://blueimp.net`。
- 映射表：已核实原 literal 的 MIT/作者/版本元数据，且其全部键值与研究缓存 `forest-table.json` 一致。**在已检查来源中未找到该表单独的完整上游版权告知或版权年份**；附录及 JS 注释中的 MIT 正文明确是随元数据声明附上的标准条款，不冒充逐字取得的上游版权声明。未编造年份；再分发前仍应确认此告知来源。
- 不以原插件整体许可作为上述组件的授权依据，不作原插件整体已获 MIT 授权的判断。

## 验证

已用 Node v24.20.0 通过下方全部 **20 组 strict VM 场景**（AMD/CommonJS/抛错 getter、TextDecoder 有/无、独立 window/window 即全局对象），并通过两个 JS 文件的 `node --check`。所有键值、前导零和元数据一致，宿主属性不变，初始化网络调用为零。此检查验证迁出一致性与隔离，不替代真实加密字体的端到端测试。

以下自包含 Node 检查从仓库根目录运行；不安装依赖、不写额外文件。只读取 bundle 并校验平铺 literal 的受限语法后单独执行该对象，**不执行 SideBar bundle**。同时验证封装之外的库代码与源文件逐字相同。

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const original = read('reference/original-extension/1.17.4/extracted/lib/TyprMd5.js');
const sidebar = read('reference/original-extension/1.17.4/beautified/SideBar.js');
const libSource = read('src/vendor/typrMd5.js');
const tableSource = read('src/vendor/cxFontTable.js');
assert.equal(sha(original), '04c4a84aacb9da4df12ba40b9d4ad515bafe6d30e4627438636edb670b755795');
assert.equal(sha(sidebar), '0f0c8bbcdc720241551f3a0e1a2b5992d711c6e473ce44c2c9119f886a33b23e');
assert.equal(sha(libSource), '3226a29c48254cfcb017080e6ced22c29dbce93f60dd2b14db48726ef276b36b');
assert.equal(sha(tableSource), '6e2dfbc9890ee0d0f7b185c224430871e8c3a7d239adc9a5f90db3a482a26140');
const lines = sidebar.split('\n');
assert.match(lines[172838], /"3ErB5"/);
assert.equal(lines[172841], '    let a = {');
assert.equal(lines[193748], '    }');
const properties = lines.slice(172842, 193748);
// Flat constant properties only: no calls, getters, computed keys or spreads.
for (const line of properties) {
  assert.match(line, /^      (?:(?:"[a-f0-9]{8}"|[a-f][a-f0-9]{7}|[1-9][0-9]{7}): [0-9]+(?:e[0-9]+)?|(?:author|namespace|license|version): "[A-Za-z0-9@.]+"),?$/);
}
const literal = '{\n' + properties.join('\n') + '\n    }';
assert.equal(sha(literal), 'bf3673f83e7f62827f5590560ca9881bfd24e880f31579c57312609980e80f45');
const tablePrefix = 'const CX_FONT_TABLE = Object.freeze(';
assert.equal(tableSource.slice(tableSource.indexOf(tablePrefix) + tablePrefix.length, -3), literal);
const expected = vm.runInNewContext('"use strict"; (' + literal + ')', {}, { timeout: 1000 });
assert.equal(Object.keys(expected).length, properties.length); // No duplicate keys.
assert.equal(Object.keys(expected).length, 20906);
assert.equal(Object.keys(expected).filter(key => typeof expected[key] === 'number').length, 20902);
assert.equal(Object.keys(expected).filter(key => key.startsWith('0')).length, 1300);
assert.equal(properties.filter(line => /^      [1-9][0-9]{7}:/.test(line)).length, 449);
const originalBody = original.slice(original.indexOf('var Typr='), original.lastIndexOf('//# sourceMappingURL='));
assert.equal(originalBody.split('}(this);').length, 2);
assert.equal(libSource.slice(libSource.indexOf('var Typr='), libSource.lastIndexOf('\n  return Object.freeze')), originalBody.replace('}(this);', '}(scope);'));
assert.ok(libSource.startsWith(original.slice(0, original.indexOf('var Typr='))));
assert.ok(!libSource.includes('//# sourceMappingURL='));
const script = new vm.Script('(function () { "use strict";\n' + libSource + '\n' + tableSource + '\nreturn { lib: CX_FONT_LIB, table: CX_FONT_TABLE };\n})();');
let cases = 0;
for (const loaders of ['none', 'amd', 'cjs', 'both', 'getters']) {
  for (const decoder of [false, true]) {
    for (const windowIsGlobal of [false, true]) {
      let networkCalls = 0;
      let loaderCalls = 0;
      const networkTrap = function () { networkCalls++; throw new Error('Unexpected network access'); };
      const loaderTrap = function () { loaderCalls++; throw new Error('Unexpected host loader access'); };
      const hostTypr = Object.freeze({ host: 'Typr' });
      const hostMd5 = Object.freeze(function () { throw new Error('Unexpected host md5'); });
      const sandbox = { Typr: hostTypr, md5: hostMd5, fetch: networkTrap, XMLHttpRequest: networkTrap, WebSocket: networkTrap };
      sandbox.window = windowIsGlobal ? sandbox : { Typr: hostTypr, md5: hostMd5, fetch: networkTrap, XMLHttpRequest: networkTrap };
      if (decoder) sandbox.window.TextDecoder = TextDecoder;
      if (loaders === 'amd' || loaders === 'both') {
        const define = function () { return loaderTrap(); };
        define.amd = Object.freeze({});
        sandbox.define = Object.freeze(define);
      }
      if (loaders === 'cjs' || loaders === 'both') sandbox.module = Object.freeze({ exports: Object.freeze({ host: true }) });
      if (loaders === 'getters') {
        for (const key of ['define', 'module']) Object.defineProperty(sandbox, key, { get: loaderTrap });
      }
      const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
      const beforeGlobal = Object.getOwnPropertyDescriptors(sandbox);
      const beforeWindow = Object.getOwnPropertyDescriptors(sandbox.window);
      const { lib, table } = script.runInContext(context, { timeout: 2000 });
      for (const method of [lib.Typr.parse, lib.Typr.U.codeToGlyph, lib.Typr.U.glyphToPath, lib.md5]) assert.equal(typeof method, 'function');
      assert.equal(lib.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
      assert.notEqual(lib.Typr, hostTypr);
      assert.notEqual(lib.md5, hostMd5);
      assert.ok(Object.isFrozen(lib));
      assert.ok(Object.isFrozen(table));
      assert.equal(lib.Typr.B._tdec === null, !decoder);
      assert.equal(lib.Typr.B.readUTF8(Uint8Array.from([97, 98, 99]), 0, 3), 'abc');
      assert.deepEqual(Object.keys(table), Object.keys(expected));
      for (const key of Object.keys(expected)) assert.equal(table[key], expected[key], key);
      assert.equal(table['017fb3c3'], 40815);
      assert.equal(networkCalls, 0);
      assert.equal(loaderCalls, 0);
      assert.deepEqual(Object.getOwnPropertyDescriptors(sandbox), beforeGlobal);
      assert.deepEqual(Object.getOwnPropertyDescriptors(sandbox.window), beforeWindow);
      cases++;
    }
  }
}
console.log(`PASS: ${cases} strict VM cases; 20902 mappings + 4 metadata fields; source bytes unchanged outside wrapper.`);
```
