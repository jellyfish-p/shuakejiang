# 本地参考资料

这里存放原插件快照和真实页面样本，**不参与 `src/` 构建，也不是当前油猴版的运行时依赖**。

## 目录

```text
reference/
├── README.md
├── original-extension/
│   └── 1.17.4/
│       ├── README.md       # 版本、文件对应关系、关键代码索引
│       ├── packages/       # 原始 CRX / ZIP（Git 忽略）
│       ├── extracted/      # 原有解包文件，保持内部路径（Git 忽略）
│       └── beautified/     # 原有格式化 bundle（Git 忽略）
└── page-samples/
    ├── README.md           # 样本来源边界和使用说明
    └── chaoxing/           # 原 patched/ 页面与资源（Git 忽略）
```

- [大学搜题酱 1.17.4：原插件导航](original-extension/1.17.4/README.md)
- [超星页面样本说明](page-samples/README.md)
- [字体混淆调研](../docs/research/chaoxing-font-plugins.md)
- 当前维护的源码仍在 [`src/`](../src/)，测试在 [`scripts/`](../scripts/)。

## 原路径对应关系

| 旧位置 | 归档位置 |
| --- | --- |
| `extension.crx`、`extension.zip` | `reference/original-extension/1.17.4/packages/` |
| `extracted/` | `reference/original-extension/1.17.4/extracted/` |
| `beautified/` | `reference/original-extension/1.17.4/beautified/` |
| `patched/` | `reference/page-samples/chaoxing/` |

本次仅移动文件，没有重新解包、格式化、拆模块或修改内容。原插件的格式化源码行号保持不变。

## 维护约定

1. Git 只收录说明和索引；原包、解包/格式化产物、真实页面样本继续忽略。新克隆的仓库不会自带这些本地文件，文档中的源码链接需补齐快照后才能打开。
2. 新版本另建版本目录，不覆盖 `1.17.4/`，避免研究行号和来源混淆。
3. 不直接编辑归档中的 bundle。需要移植的能力在 `src/` 独立实现，并记录参考位置、依赖和许可。
4. 页面样本与原插件分开保存；公开样本前先脱敏。不要把真实 HTML 直接作为可信脚本运行。
5. 原扩展包含其自己的网络接口和权限逻辑；归档不代表已审计安全，也不代表整个原插件使用本项目的 MIT 许可。
