# 🤖 ClawCloud Auto Login

[![GitHub Actions](https://img.shields.io/badge/GitHub-Actions-blue?logo=github-actions)](https://github.com/features/actions)
[![Python](https://img.shields.io/badge/Python-3.11-yellow?logo=python)](https://www.python.org/)
[![Playwright](https://img.shields.io/badge/Playwright-自动化-green?logo=playwright)](https://playwright.dev/)

自动登录 ClawCloud 并保持会话活跃的自动化脚本，支持 Telegram 通知、GitHub
Releases 截图上传和 Secret 自动更新。

---

## ✨ 功能特点

- 🔐 **自动登录** - 自动完成 GitHub OAuth 登录流程
- 🌍 **区域检测** - 智能检测并处理不同区域的登录跳转
- ⏱️ **设备验证** - 支持等待设备验证批准（30秒超时）
- 🔑 **2FA 支持** - 支持 GitHub Mobile 和 TOTP 验证码输入
- 📱 **Telegram 通知** - 登录状态实时推送到 Telegram
- ☁️ **Cookie 自动更新** - 每次登录后自动更新 GitHub Session
- 📸 **截图上传** - 自动截取关键步骤并上传到 GitHub Releases
- 🔧 **Secret 自动更新** - 自动更新 GitHub Repository Secrets
- ⏰ **定时任务** - 每5天自动运行一次（可通过 GitHub Actions 调整）

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/你的用户名/ClawCloud-Auto-Login.git
cd ClawCloud-Auto-Login
```

### 2. 配置环境变量

在 GitHub 仓库的 **Settings → Secrets and Variables → Actions** 中添加以下
Secrets：

#### 必需的环境变量

| Secret 名称    | 说明                  | 示例                                        |
| -------------- | --------------------- | ------------------------------------------- |
| `GH_USERNAME`  | GitHub 用户名         | `your_username`                             |
| `GH_PASSWORD`  | GitHub 密码           | `your_password`                             |
| `GH_SESSION`   | GitHub Session Cookie | `cookie_value`                              |
| `TG_BOT_TOKEN` | Telegram Bot Token    | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `TG_CHAT_ID`   | Telegram Chat ID      | `123456789`                                 |

#### 可选的环境变量

| Secret 名称          | 说明                                            | 默认值                        |
| -------------------- | ----------------------------------------------- | ----------------------------- |
| `REPO_TOKEN`         | GitHub Personal Access Token（更新 Secrets 用） | 自动获取                      |
| `GH_TOKEN`           | GitHub PAT（上传截图到 Releases 用）            | 自动获取                      |
| `GH_REPO`            | 目标仓库（格式：`username/repo`）               | `GITHUB_REPOSITORY`           |
| `GH_RELEASE_TAG`     | Release 标签（支持时间格式）                    | `screenshots_YYYYMMDD_HHMMSS` |
| `TWO_FACTOR_WAIT`    | 2FA 等待时间（秒）                              | `120`                         |
| `DEVICE_VERIFY_WAIT` | 设备验证等待时间（秒）                          | `30`                          |

### 3. 创建 GitHub Personal Access Token

<details>
<summary>📝 创建步骤</summary>

1. 访问 GitHub **Settings → Developer settings → Personal access tokens → Tokens
   (classic)**
2. 点击 **Generate new token (classic)**
3. 设置 Note（例如：`ClawCloud Auto Login`）
4. 勾选以下权限：
   - `repo` - 完整控制 private 和 public 仓库
   - `workflow` - 更新 GitHub Actions 工作流
5. 点击 **Generate token**
6. **立即复制并保存 Token**（离开页面后将无法再次查看）

</details>

### 4. 手动触发或等待定时任务

- **手动触发**：在 GitHub 仓库页面点击 **Actions → ClawCloud 自动登录保活 → Run
  workflow**
- **自动运行**：系统会按照配置的 cron 表达式自动执行（默认每5天）

---

## 📁 项目结构

```
ClawCloud-Auto-Login/
├── .github/
│   └── workflows/
│       └── keep-alive.yml      # GitHub Actions 工作流
├── scripts/
│   └── auto_login.py           # 主脚本
├── screenshots/                # 截图目录（本地）
├── requirements.txt            # Python 依赖
└── README.md                   # 项目文档
```

---

## ⚙️ 配置说明

### Telegram Bot 设置

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 创建新机器人
3. 按照提示设置名称和用户名
4. 复制 Bot Token

获取 Chat ID：

1. 在 Telegram 中搜索 `@userinfobot`
2. 发送任意消息获取 Chat ID
3. 或创建群组并将机器人添加为管理员

### 时间格式说明

`GH_RELEASE_TAG` 支持以下时间格式：

| 格式            | 示例              | 说明           |
| --------------- | ----------------- | -------------- |
| `%Y%m%d`        | `20260114`        | 年月日         |
| `%Y%m%d_%H%M%S` | `20260114_234523` | 完整时间戳     |
| `%Y-%m-%d`      | `2026-01-14`      | 带分隔符的日期 |

---

## 📊 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions                           │
├─────────────────────────────────────────────────────────────┤
│  1. 检出代码                                                 │
│  2. 设置 Python 环境                                        │
│  3. 安装依赖（playwright、requests、pynacl）                 │
│  4. 执行 auto_login.py                                       │
│     ├─ 登录 ClawCloud                                        │
│     ├─ GitHub OAuth 认证                                     │
│     ├─ 设备验证（如果需要）                                   │
│     ├─ 2FA 验证（如果需要）                                   │
│     ├─ 区域检测与跳转                                         │
│     ├─ 会话保活                                               │
│     ├─ 截图上传到 GitHub Releases                             │
│     └─ Cookie 自动更新                                        │
│  5. 发送 Telegram 通知                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 故障排除

### 常见问题

<details>
<summary>❓ 登录失败，显示 "找不到 GitHub 按钮"</summary>

可能原因：

- ClawCloud 登录页面结构变化
- 网络连接问题

解决方案：

- 检查网络连接
- 查看运行日志中的截图
- 手动访问 `https://console.run.claw.cloud` 检查页面状态

</details>

<details>
<summary>❓ 设备验证超时</summary>

可能原因：

- 邮箱未收到验证邮件
- GitHub App 未收到推送

解决方案：

- 检查邮箱垃圾邮件文件夹
- 确保 GitHub 账户已绑定邮箱和移动设备
- 在 GitHub 设置中检查设备验证设置

</details>

<details>
<summary>❓ 2FA 验证码无法输入</summary>

可能原因：

- TOTP 输入框选择器不匹配
- Telegram Bot 未正确配置

解决方案：

- 检查 `TWO_FACTOR_WAIT` 设置
- 确认 Telegram Bot Token 和 Chat ID 正确
- 查看日志中的验证码页面截图

</details>

<details>
<summary>❓ 截图上传失败</summary>

可能原因：

- `GH_TOKEN` 未配置或权限不足
- `GH_REPO` 格式错误

解决方案：

- 确认 `GH_TOKEN` 具有 `repo` 权限
- 检查 `GH_REPO` 格式（`username/repo`）
- 查看 GitHub Actions 运行日志中的详细错误

</details>

### 查看日志

GitHub Actions 运行日志是排查问题的最佳方式：

1. 进入仓库 **Actions** 页面
2. 选择对应的运行记录
3. 查看 **Run python scripts/auto_login.py** 步骤的详细日志

---

## 📝 更新日志

### v1.0.0（2026-01-14）

- ✨ 初始版本发布
- 🔐 支持自动登录 ClawCloud
- 🌍 区域自动检测
- 📱 Telegram 通知集成
- 📸 GitHub Releases 截图上传
- 🔧 Secret 自动更新
- ⏰ 定时任务支持

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 创建 Pull Request

---

## 📄 许可证

本项目基于 MIT 许可证开源。

---

## 🙏 致谢

- [Playwright](https://playwright.dev/) - 浏览器自动化
- [GitHub Actions](https://github.com/features/actions) - CI/CD
- [Telegram Bot API](https://core.telegram.org/bots/api) - 消息通知

---

## 📧 联系

如有问题或建议，请提交
[Issue](https://github.com/你的用户名/ClawCloud-Auto-Login/issues)。

---

<p align="center">
  <sub>Made with ❤️ by ClawCloud Auto Login</sub>
</p>

# ClawCloud-Run 自动登录助手

这是一个通过 GitHub Actions 实现的自动化脚本，用于定时自动登录
[ClawCloudRun](https://console.run.claw.cloud/signin?link=WRJQ4YKZNLI5)，以保持账户活跃。

## ✨ 主要功能

- **🤖 自动登录**: 定时执行登录操作，避免账户因不活跃而被清空项目。
- **🌍 区域自适应**: 自动检测并跳转到账户所在的区域。
- **🔒 安全验证支持**:
  - 支持设备授权验证 (Device Verification)。
  - 支持两步验证 (2FA)，包括：
    - GitHub 移动应用批准。
    - 通过 Telegram 机器人发送验证码 (`/code 123456`)。
- **🔔 实时通知**: 通过 Telegram 机器人发送登录结果、设备验证和两步验证请求。
- **🍪 Cookie 自动更新**: 登录成功后，可自动更新 GitHub Secrets 中的
  `GH_SESSION`，免去手动更新的麻烦。

## 🚀 如何部署

1. **Fork 本仓库**: 点击右上角的 "Fork" 按钮，将此项目复制到你自己的 GitHub
   账户下。
2. **配置 Secrets**: 在你 Fork 的仓库中，进入 `Settings` ->
   `Secrets and variables` -> `Actions`。点击
   `New repository secret`，添加以下变量：

## ⚙️ 配置变量

| Secret 名称       | 是否必须 | 描述                                                                                                                            |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GH_USERNAME`     | **是**   | 你的 GitHub 用户名。                                                                                                            |
| `GH_PASSWORD`     | **是**   | 你的 GitHub 密码。                                                                                                              |
| `GH_SESSION`      | **是**   | GitHub 的 `user_session` Cookie 值。首次运行时可不填，脚本会自动获取并提示你更新。如果配置了 `REPO_TOKEN`，脚本可自动更新此值。 |
| `TG_BOT_TOKEN`    | **是**   | 用于发送通知的 Telegram Bot Token。如果你需要接收登录状态或进行两步验证，则必须配置。                                           |
| `TG_CHAT_ID`      | **是**   | 你的 Telegram User ID 或 Channel ID，用于接收机器人消息。                                                                       |
| `REPO_TOKEN`      | **是**   | GitHub Personal Access Token。如果希望脚本自动更新 `GH_SESSION`，需要提供此 Token。请授予 `repo` 权限。                         |
| `TWO_FACTOR_WAIT` | 否       | 两步验证的等待时间（秒），默认为 `120`。                                                                                        |

## ▶️ 如何运行

- **自动运行**: 默认配置下，脚本会**每 5 天**自动运行一次。你可以在
  `.github/workflows/keep-alive.yml` 文件中修改 `cron`表达式来调整运行频率。
- **手动运行**:
  1. 进入 Fork 后的仓库页面。
  2. 点击 `Actions` 选项卡。
  3. 在左侧选择 `ClawCloud 自动登录保活`。
  4. 点击右侧的 `Run workflow` 按钮，即可立即触发一次登录任务。

## 🙏 致谢

本项目基于 [oyz8/ClawCloud-Run](https://github.com/oyz8/ClawCloud-Run)
做了些调整，感谢原作者的贡献。
