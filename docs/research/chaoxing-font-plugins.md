# 超星字体混淆：开源插件源码调研

核验日期：2026-10-26。对照本地原插件与外部开源源码，未修改业务代码，未运行第三方脚本、未用真实作业验证识别率。外部证据来自 GitHub API/raw、脚本官方分发地址；没有克隆大型仓库。

## 结论先行

核实了 **OCS 与 wyn665817《超星字体解密》两个项目**，其中 OCS 必须区分新旧实现：

| 实现及核验版本 | 实际方法 | MD5 的对象 | 替换位置 |
| --- | --- | --- | --- |
| OCS `5.0` 分支快照 `da5c0775…` | 浏览器加载字体 → Canvas 单字渲染 → 二值特征最近邻匹配 | 这条解密链不使用 MD5 | 改写 `.font-cxsecret` 区域的文本节点 |
| OCS 迁移前 `419541ee…` | Typr 解析字体 → glyph 路径指纹 → JSON 字典 | `JSON.stringify(glyphToPath(...))`，取 MD5 十六进制末 8 位 | 改写加密元素 `innerHTML` |
| wyn 脚本已读取的 v1.1.2 | Typr + 同类路径指纹字典 | 同上；不是整个字体文件的 MD5 | `$('.font-cxsecret').html(...)` |

证据分别见 [OCS 当前入口][ocs-entry]、[OCS 旧算法][ocs-old]、[wyn 官方脚本源码][wyn-code]。**没有在这些已核实的调用链中发现通用 OCR 引擎或远程 OCR 接口。** 新 OCS 是专用字形模板匹配，不宜把它说成“仍用 MD5”，也不宜称其完全不涉及图像识别。

## 1. OCS 当前分支：位图特征匹配，已替换旧 MD5 方案

### 版本边界

本次 GitHub `5.0` 分支指向 `da5c0775a9d055724149ff505eae75bd85d334f9`。这是**仓库分支快照，不等于所有用户安装的已发布版本**。迁移提交 [`7c015b9769…`](https://github.com/ocsjs/ocsjs/commit/7c015b9769cd683246678c37fb13b18158f178e6)（提交时间 2026-09-24）明确写出“超星 font-cxsecret 解密由 typr.js/md5 哈希方案迁移至 font-decrypt 位图匹配”。迁移前父提交为 `419541ee6eea89cfac334717f24bed56cc63fe66`。

### 实际链路

1. **定位字体**：`extractFontFromStyle(doc, 'font-cxsecret')` 只找 `doc.head` 中首个包含该标记的内联 `<style>`，正则抽出 Base64，`atob` 转 `Uint8Array`/`ArrayBuffer`。找不到字体，或找不到加密元素，直接返回。虽然框架还提供外链字体 URL 查找工具，**超星入口实际没有使用它**。[提取函数 L351–363][ocs-extract]；[入口 L1187–1197][ocs-entry]。
2. **解析/加载**：不再自行用 Typr 解 TTF；把字节交给浏览器原生 `FontFace`。优先 Worker：`await face.load(); self.fonts.add(face)`，使用 `OffscreenCanvas`；不支持、CSP 拦截或失败/30 秒超时，则回退主线程。主线程也明确等待 `face.load()`，有 15 秒超时，随后加入 `document.fonts`。这是**新建识别用字体的加载等待**，不是“等原网页字体显示好了再读 innerText”。[主线程 L229–257][ocs-crack]；[Worker L148–178、190–244][ocs-worker]。
3. **字形匹配**：只处理加密区域实际出现的去重字符。按固定 480×480 画布、360px 字号、y=384 基线渲染，提取 alpha，盒式平均降采样并二值化；先用粗特征全表筛选约 40 个候选，再用精特征选最近者。所谓距离实质是不同位个数。无图像上传、无 Tesseract/神经网络 OCR。[渲染 L42–122][ocs-render]；[匹配 L167–219][ocs-match]。
4. **映射资源**：读取 [`font_ref_cx.bin`](https://cdn.ocsjs.com/resources/font/font_ref_cx.bin)，不是旧 `table.json`。FRB2 文件包含候选 Unicode 码点和粗/精二值特征，URL 级缓存、加载超时 30 秒。本次只读检查文件头得到 `count=7027, threshold=30, gc=16, gf=24`。源码注释称来自 Source Han Sans Normal 的离线生成；提到的 `.codebuddy/font_analysis/` 生成脚本不在本次公开树中，故**未复核生成过程或“永久有效”的说法**。[资源地址 L33–38][ocs-table-url]；[格式/加载器 L1–92][ocs-ref]。
5. **替换题干与选项**：先收集 `.font-cxsecret` 元素；若内部有 `.after`，优先取该子元素以避开选项按钮。匹配完成后 `TreeWalker(..., SHOW_TEXT)` 遍历文本节点，一次逐字符映射，未映射字符保留；随后移除所选元素的加密 class。不是修改搜题返回结果，而是**先修复页面 DOM，供后续题干/选项抽取使用**。[元素选择 L1313–1319][ocs-elements]；[替换 L289–309][ocs-replace]。

关键原文（[入口 L1202–1213][ocs-entry]，省略进度/告警代码）：

```ts
const { map, details } = await crackFont(fontBuffer, collectChars(fonts), {
    refTableUrl: CX_SECRET_REF_TABLE_URL,
    // ...
});
decryptElements(fonts, map);
fonts.forEach((el) => el.classList.remove('font-cxsecret'));
```

**调用时机与边界**：`cxSecretFontRecognize` 在匹配 `work/doHomeWorkNew`、`/mooc2/exam/preview`、`/mooc2/work/dowork` 的页面 `oncomplete` 中调用；题目 worker 再从 DOM 提取题干和选项。[触发 L776–786][ocs-hook]；[抽取 L830–918][ocs-question]。但 `workOrExam()` 本身没有显式 `await mappingRecognize()`；仅凭此处源码不能保证所有异步加载/翻页场景都没有竞态，不能把框架另有动态监听能力等同于超星入口已使用动态监听。

**局限（源码可见或据此推导）**：

- 当前超星入口只处理首个匹配的内联 Base64 字体，没有处理外链/一页多字体的完整分组逻辑。[提取][ocs-extract]
- 检测字体是否包含字符采用 serif/sans-serif 双回退渲染比较，不是读取 cmap；两个系统回退字体若恰好相同，理论上可能误判。[覆盖检测 L125–165][ocs-coverage]
- 最近邻依赖参考字体、字重、候选字集合及坐标归一化；换字体或出现表外字不能保证正确。`margin < 0.3` **仅告警，仍写回结果**，没有自动 OCR 兜底或拒绝低置信度替换。[匹配][ocs-match]；[写回 L1206–1213][ocs-entry]

## 2. OCS 历史实现，以及 wyn《超星字体解密》v1.1.2

### OCS 历史实现：准确理解“MD5 解密”

[迁移前 `cx.ts` L1026–1111][ocs-old] 是主源码，不是教程。流程为：

- `top.typrMapping || await loadTyprMapping()` 缓存公共指纹表；访问顶层窗口跨域失败时在当前窗口加载。**先加载映射表，再检测当前页面有无加密字体**。表请求是 `GM_xmlhttpRequest` GET `https://cdn.ocsjs.com/resources/font/table.json`，不是发送题目给服务器识别。
- 查找 `head style` 中 `font-cxsecret`，要求映射表非空，正则 `/base64,([\w\W]+?)'/` 抽取字体，`atob` 转字节后 `Typr.parse(...)`。**不要求 `document.fonts.ready` 或浏览器先加载字体**，因为算法直接解析字节。
- 扫描码点 `[19968, 40869]`，`codeToGlyph` 得 glyph 索引，跳过 0，再把路径对象 JSON 化并 MD5。哈希的对象**不是 Unicode 文本、不是 glyph ID、不是整个 TTF、也不是 Canvas 截图**：

```ts
const Glyph = Typr.U.codeToGlyph(code, i);
if (!Glyph) continue;
const path = Typr.U.glyphToPath(code, Glyph);
const hex = md5(JSON.stringify(path)).slice(24);
match[i.toString()] = fontMap[hex];
```

- 字典结构是“路径指纹 → 正常字符码点”，现场构造“混淆码点 → 正常码点”，随后对加密区域的 `innerHTML` 逐项替换，并移除 class；不是简单删除字体样式。[L1072–1092][ocs-old]

**局限**：路径坐标/命令变化即可能失配，截断 MD5 也不是无碰撞保证；仅扫描上述汉字区间。源码未检查 `fontMap[hex]` 缺项就调用 `String.fromCharCode(...)`，可能将缺项转换为 NUL。逐映射项修改整段 HTML 有级联替换和事件绑定损坏风险；当前 OCS 的文本节点单次映射避免了这类 HTML 重建问题。[旧替换][ocs-old]；[新替换][ocs-replace]

### wyn v1.1.2：独立脚本确实使用同一路径指纹方案

直接读取了作者官方分发的 [v1.1.2 源码][wyn-code]（共 64 行，行号以原始文件计）；[Greasy Fork 代码页面][wyn-page] 可辅助浏览。ScriptCat 版本页还列出 v1.1.3，但本次请求该源码被 403 拒绝，**不把 v1.1.2 当成作者所有分发渠道的最新版，不推断 v1.1.3 实现**。

- L7–16：仅匹配若干 `doHomeWorkNew` 路径，`document-end` 运行；`@require TyprMd5.js`，`@resource Table https://www.forestpolice.org/ttf/2.0/table.json`。表由脚本管理器提供，正文用 `GM_getResourceText('Table')`，不是识别时现做 OCR。
- L27–43：`$('style:contains(font-cxsecret)')` 不存在就返回；Base64 → `Typr.parse(...)[0]`；扫描同一汉字区间，并执行 `md5(JSON.stringify($tip)).slice(24)`。
- L46–55：直接 `$('.font-cxsecret').html(...)` 全局替换后 `.removeClass('font-cxsecret')`，所以题干、选项只要在这些区域内都会被改写；没有针对搜题器的专有接口或额外等待屏障。

关键原文：

```js
$tip = Typr.U.codeToGlyph(font, i);
if (!$tip) continue;
$tip = Typr.U.glyphToPath(font, $tip);
$tip = md5(JSON.stringify($tip)).slice(24);
match[i] = table[$tip];
```

这里 `glyphToPath` 返回的对象可进一步追到依赖主源码：[`Typr.U.js` 固定提交 L150–173][typr-path] 的 `return {"cmds":path.cmds, "crds":path.crds}`。依赖聚合文件 [TyprMd5.js][typr-bundle] 的文件头列出这个上游 commit。因此它匹配的是**路径绘制指令及坐标的序列化结果**，不是抽象的“同一个字看起来相似”就会匹配。

与旧 OCS 相同，它依赖稳定字形指纹、公共表可用和正则能抓到内联字体；没有表缺项保护、通用 OCR 兜底或动态 DOM 监听。对新扰动字体能否成功不能由“脚本仍可下载”推断。本次读取的用户脚本 SHA-256：`e2e702e891bc871000a7ffabdbf262a9ef9537acfaf8c2a2b6e5b4723deb7cbf`，用于标识无 commit 固定链接的源码快照。

## 3. 许可证边界

- **OCS 主仓库：MIT**，见固定提交 [`LICENSE`][ocs-license]；复制实现仍需保留版权/许可声明。
- **wyn v1.1.2：头部 `@license MIT`**；上游 [Typr 固定提交 LICENSE][typr-license] 也是 MIT。依赖集合不应只因主脚本 MIT 就省略逐项保留声明。
- **旧 JSON 指纹表不是完全无声明**：本次读取 [OCS CDN table.json][json-table] 和 [wyn 指向的 table.json][wyn-table]，均含 `author: "wyn665817"`、`namespace: "wyn665817@163.com"`、`license: "MIT"`、`version: "20220515.1"`。这是资源自身的授权声明；不应只凭可下载就认定其他字库也同样授权。
- **新 FRB2 特征表**：公开加载器说明其来源，但本次没有找到该 CDN 二进制随附的独立许可/生成脚本，**不能直接把仓库 MIT 推广成所有字体文件、派生特征表都已完成授权核验**。若要打包复用，应再核对原字体和特征数据许可。本次未复制第三方库/字库到本仓库。

## 4. 本地原插件与油猴版接入前对照

> 本节记录 v2.1.4 接入前的状态，`src/` 行号对应当时快照。v2.2.0 已接入查表/视觉两种策略，当前行为与限制见 [字体处理说明](../font-handling.md)；原插件归档的行号不变。

原插件已归档到 `reference/original-extension/1.17.4/`，见 [文件导航与关键代码索引](../../reference/original-extension/1.17.4/README.md)。移动未改变文件内容或行号；以下原插件 `SideBar.js` 行号均以该归档版本为准。

已逐段静态核实 `reference/original-extension/1.17.4/beautified/SideBar.js:167423–167443` 的 `hasFont`：Base64 → Typr → glyph 路径 JSON → MD5 末 8 位 → `p.table` → HTML 替换。它对原 HTML 单次逐字符映射，查不到映射时保留原字符；不要与旧 OCS/wyn 的逐映射项循环替换混为一谈。

`:195988` 在 `resolveWorkContentForExecutor` 采题前 `await hasFont`，随后 `:196005–196020` 才以 `innerText` 读取题目。与仅有独立页面解码钩子的参考脚本相比，这里有明确的采题前等待。仅确认章节测验调用链，未确认独立考试页覆盖，未做真实页面验证。

本地表在 `:172839–193749`，末尾 `:193745–193748` 含 `author: "wyn665817"`、`namespace: "wyn665817@163.com"`、`license: "MIT"`、`version: "20220515.1"`，与外部 JSON 表元数据一致；**这只是表自身的 MIT 声明，不等于整个原扩展是 MIT**。`reference/original-extension/1.17.4/extracted/lib/TyprMd5.js` 有固定 Typr/MD5 版本来源头。

接入前的 v2.1.4 油猴版未保留还原能力：

- `src/modules/chaoxing/cxDom.js:416` 的 `hasFontObfuscation` 只检测 `.font-cxsecret` 或包含该字符串的 style。
- `src/modules/exam/examAssistant.js:109–112` 检测到混淆就跳过章节测验；`:235` 起的 `extractCxQuestion` 仍直接用 `innerText` 提取题干和选项。
- 同文件 `:527` 起的独立作业/考试分支直接提取 `innerText`，没有相同的字体检测保护。

**调研时的接入建议**：先用实际失败页面的字体与题目样本核验已有指纹表是否命中，再决定是否需要位图匹配；不能仅凭源码存在便承诺支持当前平台字体。解码应位于题目采集前，按实际题目 Document/字体区分状态，失败或低置信度时保留不提交策略。原算法只移除 class、保留 style，所以照搬后当前 guard 仍会认为存在混淆；需要明确的解码结果状态，而不是简单删除保护判断。若修改页面，应优先只改文本节点，避免重建 innerHTML 破坏事件与结构。

## 来源索引

下列 GitHub 链接均固定到本次核验的提交，脚本/CDN 链接为实际读取地址：

[ocs-entry]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/projects/cx.ts#L1187-L1219
[ocs-table-url]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/projects/cx.ts#L33-L38
[ocs-elements]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/projects/cx.ts#L1313-L1319
[ocs-hook]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/projects/cx.ts#L776-L786
[ocs-question]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/projects/cx.ts#L830-L918
[ocs-extract]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L351-L363
[ocs-crack]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L229-L286
[ocs-render]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L42-L122
[ocs-coverage]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L125-L165
[ocs-match]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L167-L219
[ocs-replace]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/bitmap.ts#L289-L309
[ocs-ref]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/ref-table.ts#L1-L92
[ocs-worker]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/packages/scripts/src/utils/font-decrypt/worker.ts#L148-L244
[ocs-old]: https://github.com/ocsjs/ocsjs/blob/419541ee6eea89cfac334717f24bed56cc63fe66/packages/scripts/src/projects/cx.ts#L1026-L1111
[ocs-license]: https://github.com/ocsjs/ocsjs/blob/da5c0775a9d055724149ff505eae75bd85d334f9/LICENSE
[wyn-code]: https://update.greasyfork.org/scripts/445007/%E8%B6%85%E6%98%9F%E5%AD%97%E4%BD%93%E8%A7%A3%E5%AF%86.user.js
[wyn-page]: https://greasyfork.org/en/scripts/445007-%E8%B6%85%E6%98%9F%E5%AD%97%E4%BD%93%E8%A7%A3%E5%AF%86/code
[typr-bundle]: https://update.greasyfork.org/scripts/445293/TyprMd5.js
[typr-path]: https://github.com/photopea/Typr.js/blob/f4fcdeb8014edc75ab7296bd85ac9cde8cb30489/src/Typr.U.js#L150-L173
[typr-license]: https://github.com/photopea/Typr.js/blob/f4fcdeb8014edc75ab7296bd85ac9cde8cb30489/LICENSE
[json-table]: https://cdn.ocsjs.com/resources/font/table.json
[wyn-table]: https://www.forestpolice.org/ttf/2.0/table.json
