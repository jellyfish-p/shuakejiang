# CI / CD 与发版流程

## 触发规则

| 事件 | 工作流 | 结果 |
| --- | --- | --- |
| 普通 push 到 `main` | `Userscript CI` | 校验版本、构建、检查产物同步、运行全部测试；不创建 Release |
| PR 目标分支为 `main` | `Userscript CI` | 同上；不创建 Release |
| push 新的 `vX.Y.Z` 标签 | `Userscript CD` | 复用 CI 校验；通过后自动创建 GitHub Release 并上传 `shuakejiang.user.js` |
| 其他分支或非 `v` 开头标签 | 不由这些 push 规则触发 | 不发版 |

普通 `main` push 不再设置路径过滤，因此仅修改文档也会执行 CI。工作流更新本身不会重发已有的 v2.2.0。

- CI：[`ci.yml`](../.github/workflows/ci.yml)，提供 `workflow_call` 供 CD 复用。
- CD：[`release.yml`](../.github/workflows/release.yml)，仅由 `v*` 标签触发。
- 版本校验：[`scripts/release-check.js`](../scripts/release-check.js)。

`v*` 只是触发过滤器，发版校验只接受无前导零的 **`vX.Y.Z` 正式版本**。例如 `v2.2.1` 有效；`v2.2`、`v02.2.1`、`v2.2.1-rc.1` 不会发布。当前没有预发布版本流程。

## 发版前置条件

以下版本必须一致：

1. `package.json` 的 `version`。
2. `src/header.js` 顶部元数据的 `@version`。
3. 构建后 `shuakejiang.user.js` 顶部元数据的 `@version`。
4. 发布标签，等于上述版本加 `v` 前缀。

CI 检查前三项；标签触发的 CD 还检查第四项。脚本内第三方库自己的元数据不会被误当作主脚本版本。

CD 必须先通过构建、产物同步检查和完整测试。CI 只读仓库权限；只有 CD 的发布 job 使用 `contents: write` 与内置 `GITHUB_TOKEN`，不需要另设 PAT。

## 日常提交

```bash
npm run build
npm test
# 提交本次需要的源码、脚本和文档，再推送 main。
git push origin main
```

这只运行 CI，不需要手动调用 `gh release create`。

## 发布新版本

以下以**尚未使用的** `2.2.1` 为例；不要对已存在的版本重复打标签。

1. 在 `main` 更新版本字段；同步设置面板版本徽标与 README 更新说明。
2. 构建、测试并提交，推送 `main`，确认 CI 成功。
3. 给该提交创建新标签并推送：

```bash
npm run build
npm test
# 完成源码/产物提交，且 package/header/userscript 均已是 2.2.1。
git push origin main

git tag -a v2.2.1 -m "刷课酱 v2.2.1"
git push origin refs/tags/v2.2.1
```

CD 会对标签提交再执行一遍共用校验，然后：

- 下载该次 CI 验证过的 artifact，不改用 `main` 的最新文件，也不重新生成另一个安装包。
- 检查标签对应提交、版本，以及附件与提交中脚本的逐字节一致性。
- 创建标题为 `刷课酱 vX.Y.Z` 的正式 Release，自动生成 GitHub 更新日志，并上传安装脚本。

Release 地址：`https://github.com/jellyfish-p/shuakejiang/releases/tag/vX.Y.Z`。

## 失败与重跑

- 任一验证失败时，发布 job 不运行；修复源码并用新版本标签发布，**不要强制移动已发布标签**。
- 网络等临时失败可在 Actions 页面重跑；相同标签的发布任务会串行执行，避免并发上传。
- 如果该标签已经存在同名 Release，`gh release create` 会失败而不会覆盖已有版本/附件。先检查 Release 的实际状态；不要通过删除或强推标签来重发。
- 构建与测试不依赖本机忽略的原扩展包、解包文件或真实网页样本。

## 安装更新渠道说明

本次分离的是 **CI 与 GitHub Release 发布**。现有油猴 `@updateURL` / `@downloadURL` 仍指向 `main` 的 raw 文件，因此提交到 `main` 的新脚本版本仍可能被已安装用户获取，并不等待 tag。若以后希望安装端也只跟随正式 Release，需要另行调整更新渠道；本次没有改动该行为。
