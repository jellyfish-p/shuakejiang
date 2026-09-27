# 刷客酱 - 网课视频助手 & AI 解题助手 (油猴脚本)

本项目是将 Edge 官方商店扩展 **大学搜题酱插件**（Extension ID: `abkclgdmdkokpdkbpdkoiiemhcaafbkg`）下载并逆向反编译，彻底剔除所有冗余追踪、推广、扫码登录以及 VIP 限制后，重新重构并移植而成的**油猴（Tampermonkey / ScriptCat）脚本**。

---

## 🌟 核心功能特性

### 1. 视频助手 & 自动连播
- **底层反检测倍速 HOOK**：在 `document-start` 阶段 Hook `HTMLMediaElement`，拦截播放器自身绑定的 `ratechange`、`seeked`、`seeking` 等监听器，防止被平台脚本强制重置为 1 倍速或阻断拖动。
- **自动播放与静音**：自动对音视频设置静音（绕过现代浏览器的 AutoPlay 限制）并自动调用 `play()`。
- **防暂停与自动解除遮罩**：自动识别超星视频批注弹窗、播放暂停遮罩，自动点击继续学习。
- **视频随堂弹题自动处理**：
  - 智慧树视频随堂测试：直接从 Vue 实例读取原生答案并自动提交关闭。
  - 超星视频弹出测验：自动提取题干，调用 AI 给出答案并自动勾选提交。
- **多平台自动跳转下一节**：
  - 支持 **超星学习通**（章节内部多标签卡切换、章节底部下一节、目录下一节点）。
  - 支持 **智慧树**（小节资源列表自动切播、章节目录下一视频小节）。
  - 支持 **智慧职教 ICVE**、**中国大学 MOOC**、**学堂在线** 等平台的视频接续播放。

### 2. AI 解题助手（OpenAI 兼容接口）
彻底废弃原插件连接其官方私有付费接口的逻辑，全面升级为 **OpenAI 兼容格式** 请求：
- **自由配置 API**：用户可在前端界面中任意配置 `API Key`、`Base URL` 与 `Model`。
  - 支持官方 **OpenAI**（`gpt-4o-mini`, `gpt-4o` 等）。
  - 支持高性价比国内模型如 **DeepSeek**（`https://api.deepseek.com/v1`, 模型 `deepseek-chat`）。
  - 支持 **硅基流动 (SiliconFlow)**、**Moonshot (Kimi)**、**智谱 (Zhipu)**、**OneAPI / NewAPI** 中转。
  - 支持 **本地 Ollama / vLLM**（例如 `http://localhost:11434/v1`）。
- **智能题型解析与格式化 Prompt**：
  - 准确识别 **单选题**、**多选题**、**判断题**、**填空题**、**简答题**。
  - 严格约束大模型返回纯净答案（单选返回 `A`，多选返回 `ABCD`，判断返回 `正确/错误`，填空使用 `#` 分隔）。
- **自动 DOM 填入**：
  - 适配超星学习通 **章节测验**（嵌套 iframe 内部题目自动提取、答案匹配点击、自动暂存）。
  - 适配超星学习通 **独立作业/考试页**（`.questionLi` 结构高精度匹配与填入）。
  - 适配智慧树 **在线测试/作业**。
- **安全保障**：
  - 默认关闭“自动提交”，建议在 AI 答题完成后，人工核对无误后再行点击提交。

### 3. 现代化悬浮控制面板
- **不污染宿主样式**：纯原生隔离样式渲染，避免与目标网页 CSS 冲突。
- **可平滑拖拽**：右上角胶囊浮球，支持随意拖拽到屏幕任意位置，坐标自动持久化保存。
- **功能分栏**：
  - 📊 **控制仪表盘**：当前运行状态实时显示、一键手动答题、强制下一节、实时日志窗口。
  - 🎬 **视频设置**：连播开关、倍速选择（1.0x ~ 2.5x）、静音开关、弹题处理开关。
  - 🧠 **AI 接口配置**：Base URL、API Key（支持明文隐藏切换）、Model、自动提交开关、**⚡ 一键测试 API 连接** 按钮。

---

## 🚀 安装与一键更新指南

### 方式一：GitHub 一键在线安装（推荐，支持全自动更新）
安装好浏览器扩展 **Tampermonkey（篡改猴）** 或 **ScriptCat（脚本猫）** 之后，直接点击下方安装链接即可：

- **[👉 点击一键在线安装（GitHub Raw 官方直链）](https://raw.githubusercontent.com/jellyfish-p/shuakejiang/main/shuakejiang.user.js)**
- **[👉 点击一键在线安装（国内 CDN 镜像加速直链）](https://cdn.jsdelivr.net/gh/jellyfish-p/shuakejiang@main/shuakejiang.user.js)**

> 点击链接后，浏览器会直接拉起 Tampermonkey / ScriptCat 的安装页面，点击“安装”即可完成。  
> 以后当该 GitHub 仓库有版本升级时，您的脚本管理器会在后台**自动检测并静默拉取最新版**！

---

### 方式二：手动复制安装
1. 打开浏览器扩展的控制面板，点击 **“新建脚本”**。
2. 复制本项目根目录下的 `shuakejiang.user.js` 全部代码并粘贴进去。
3. 按 `Ctrl + S` 保存即可。

---

### 配置 OpenAI API（初次使用）
1. 打开任意超星/学习通或智慧树课程页面，页面右上角会出现 `[🤖 刷客酱]` 悬浮按钮。
2. 点击按钮右侧的 `⚙️` 图标打开控制台。
3. 切换到 **【🧠 AI 接口配置】** 标签页：
   - **API 接口地址**：填写您的 API 服务地址（例如 `https://api.deepseek.com/v1` 或 `https://api.openai.com/v1`）。
   - **API Key**：填写您的密钥（例如 `sk-...`）。
   - **模型名称**：填写对应的模型 ID（例如 `deepseek-chat` 或 `gpt-4o-mini`）。
4. 点击 **【⚡ 测试 API 连接】**，确认弹出连接成功的提示。
5. 点击 **【💾 保存全部设置】** 即可！

---

## 🛠️ 项目工程结构与二次开发

本项目已重构为清晰易维护的**模块化工程体系**，源码全部位于 `src/` 目录下，并提供**零外部依赖**的自动化构建脚本：

```text
├── src/
│   ├── header.js               # 油猴 UserScript 元数据头注释配置
│   ├── config.js               # 本地持久化存储与默认配置管理
│   ├── index.js                # 主入口与各模块联动引导
│   ├── core/
│   │   ├── mediaHook.js        # HTMLMediaElement 原型链反检测倍速 Hook
│   │   ├── site.js             # 各大网课平台特征与页面类型识别
│   │   └── state.js            # 响应式全局状态机与日志流订阅系统
│   ├── api/
│   │   └── openai.js           # OpenAI / DeepSeek 标准接口适配与请求封装
│   ├── modules/
│   │   ├── video/
│   │   │   └── videoAssistant.js   # 视频自动播放、防暂停、自动下一节、完成状态预检
│   │   └── exam/
│   │       ├── parser.js           # 题目解析与 Prompt 格式化工具
│   │       └── examAssistant.js    # 超星/智慧树章节测验全自动答题与提交核心
│   └── ui/
│       ├── styles.js           # 悬浮控制面板现代化 CSS 样式表
│       └── uiController.js     # 悬浮胶囊球拖拽、设置模态窗与控制台交互
├── scripts/
│   ├── build.js                # 零依赖自动化打包脚本 (支持 --watch 热重载)
│   └── check.js                # CI 质量校验与语法/元数据完整性测试
├── shuakejiang.user.js          # 打包生成的生产就绪油猴用户脚本
├── package.json
└── README.md
```

### 开发与打包命令

```bash
# 1. 执行一次性打包构建（生成/更新 shuakejiang.user.js）
npm run build

# 2. 启动文件热监听开发模式（修改 src/ 自动重新打包）
npm run watch

# 3. 运行语法与代码质量规范校验
npm test
```

---

## ⚠️ 免责声明
本脚本仅用于个人学习交流及前端代码逆向研究，请合理使用大模型与脚本工具，遵守所在平台的用户使用守则。
