# 大学搜题酱插件 1.17.4 — 本地参考快照

本目录按只读参考维护，不参与当前油猴版构建。`packages/`、`extracted/`、`beautified/` 由 Git 忽略；新克隆的仓库只有本说明，不会自动下载原插件。

## 快照信息

| 项目 | 记录 |
| --- | --- |
| 名称 | 大学搜题酱插件 |
| 版本 | `1.17.4`，以 `extracted/manifest.json` 为据 |
| 扩展格式 | Manifest V3 |
| 原有仓库记录的来源 | Microsoft Edge 扩展商店 |
| Extension ID | `abkclgdmdkokpdkbpdkoiiemhcaafbkg` |
| 原包 | `packages/extension.crx`、`packages/extension.zip` |
| 解包目录 | `extracted/`，140 个文件，保持原有内部路径 |
| 格式化目录 | `beautified/`，13 个 JavaScript bundle |

来源记录可交叉查看仓库根 README、`extracted/manifest.json` 和 `beautified/cx.0d72b60b.js` 内的 `VERSION`、`CHANNEL`、`MarketLinkMap`。本次未重新下载扩展，未验证商店签名，也未重新证明 ZIP 与 CRX 的生成关系；以上是现有本地材料的归档信息。

`beautified/` 是打包脚本的格式化阅读副本，**不是恢复出的完整上游工程源码**。不要直接将其作为可独立运行的模块使用。

## 文件导航

以下路径均相对本版本目录；表格用于定位原包文件与现有阅读副本，不表示本次重新生成或验证了格式化过程。

| 用途 | 原包文件（`extracted/` 下） | 阅读副本（`beautified/` 下） |
| --- | --- | --- |
| 扩展权限、注入入口、资源清单 | `manifest.json` | 直接阅读原 JSON |
| 侧栏、课程执行、题目采集与主要业务 | `SideBar.d70b0916.js` | `SideBar.js` |
| 后台 service worker | `static/background/index.js` | `index.js` |
| 通用内容脚本入口 | `main.7ee886d8.js` | 同名文件 |
| 超星课程信息收集入口 | `cx.0d72b60b.js` | 同名文件 |
| 超星学习页任务扫描及页面桥接 | `brushCx.ac53035b.js` | 同名文件 |
| 超星 UEditor 填入桥接 | `cxExam.4968e635.js` | 同名文件；并非全部考试逻辑 |
| 媒体倍速相关脚本 | `videoplayrate.4e59ba0f.js` | 同名文件 |
| 设置页 bundle | `options.2a742e8f.js` | `options.js` |
| 独立标签页 bundle | `tabs/index.52e022fc.js` | `tabs.js` |
| 智慧树页面脚本 | `zhs.8da68acf.js`、`zhsIndex.8b2f903d.js` | 同名文件 |
| 职教编辑器、学堂在线页面脚本 | `icveWorkEditor.4e28e818.js`、`xtOnline.fe9a1810.js` | 同名文件 |
| Typr 字体解析与 MD5 依赖 | `lib/TyprMd5.js` | 无单独格式化副本 |

图片、CSS、HTML、`_metadata/` 和随包依赖仍完整保存在 `extracted/`，没有按文件类型拆散，以免破坏扩展内部相对路径。

## 超星关键代码索引

以下行号全部对应本快照的 **`beautified/SideBar.js`**，移动文件不会改变这些行号：

| 功能 | 位置 / 搜索锚点 | 已确认内容 |
| --- | --- | --- |
| 字体还原 | `167423–167443`；模块 `5Fjnv` 的 `hasFont` 导出 | Base64 字体 → Typr → 字形路径 MD5 末 8 位 → 查表 → 替换文字 |
| 字形指纹表 | `172839–193749`；模块 `3ErB5` | 指纹到正常字符码点的映射；末尾附作者、许可、版本 |
| work 任务注册 | `194903`；`executeWorkTask` | 章节测验执行入口 |
| 测验文档准备 | `195983–195990`；`resolveWorkContentForExecutor` | 定位任务 iframe / `#frame_content`；`195988` 在采题前等待字体还原 |
| 章节测验题目采集 | `196005–196020`；`captureWorkQuestionForExecutor` | 读取题干、题型及选项 `innerText` |

字体依赖单独位于 [`extracted/lib/TyprMd5.js`](extracted/lib/TyprMd5.js)。机制、失败边界和其他插件对比见 [字体混淆调研](../../../docs/research/chaoxing-font-plugins.md)。这里仅确认上述静态调用链，不代表已验证当前超星页面兼容性。

快速定位（在仓库根目录执行）：

```bash
rg -n 'hasFont|resolveWorkContentForExecutor|captureWorkQuestionForExecutor|executeWorkTask' reference/original-extension/1.17.4/beautified/SideBar.js
```

## 原包校验值

SHA-256 对应本次归档前后的本地文件，仅用于校验副本一致性，不是商店签名认证：

```text
35bc7e0436bf905bc796fd0c6d513c7f19d97cb1fe09ae97ce62f79b1d318250  packages/extension.crx
67cb1778e698feadeb348675b81d4f0f40ffb623f82d6531de3429d35d34b7da  packages/extension.zip
```

本次归档保留原插件 155 个文件和所有内部目录；没有执行原扩展，也没有修改 bundle。

## 许可边界

- `SideBar.js:193745–193748` 中的指纹表标注 `wyn665817`、`MIT`、`20220515.1`。
- 该声明只针对表，不能据此把整个原扩展视为 MIT。
- `TyprMd5.js` 文件头列出了固定上游版本；后续移植需保留对应版权/许可，单独核对所用组件。

返回 [参考资料总览](../../README.md)。
