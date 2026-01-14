# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ClawCloud 自动登录保活工具，通过 GitHub Actions 定时执行自动化脚本，实现自动登录 ClawCloud 并保持会话活跃。

本项目提供**两个版本**，推荐使用 **Node.js 版本**以避免机器人检测：

### 🚀 Node.js 版本（推荐）
- **主脚本**: [index.js](index.js) - 使用 **puppeteer-real-browser** 避免检测
- **工作流**: [.github/workflows/keep-alive-nodejs.yml](.github/workflows/keep-alive-nodejs.yml) - GitHub Actions 定时任务
- **优势**: 使用 rebrowser 补丁和真实浏览器指纹，**解决 REGION_NOT_AVAILABLE 检测问题**

### 📦 Python 版本（兼容）
- **主脚本**: [scripts/auto_login.py](scripts/auto_login.py) - 使用 Playwright 同步 API
- **工作流**: [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml) - GitHub Actions 定时任务
- **限制**: 可能被检测为自动化工具（REGION_NOT_AVAILABLE 错误）

**通用组件**:
- **通信方式**: Telegram Bot API（发送通知、接收 2FA 验证码）
- **存储**: GitHub Secrets（凭据）、GitHub Releases（截图）

## 运行和测试

### Node.js 版本（推荐）

```bash
# 安装依赖
npm install

# 设置环境变量
export GH_USERNAME="your_username"
export GH_PASSWORD="your_password"
export GH_COOKIES='[{"name":"user_session","value":"..."}]'
export TG_BOT_TOKEN="your_bot_token"
export TG_CHAT_ID="your_chat_id"
export REPO_TOKEN="your_repo_token"  # 可选，用于自动更新 Secret

# 运行脚本
node index.js
```

### Python 版本

```bash
# 安装依赖
pip install playwright requests pynacl
playwright install chromium
playwright install-deps

# 设置环境变量
export GH_USERNAME="your_username"
export GH_PASSWORD="your_password"
export GH_COOKIES='[{"name":"user_session","value":"..."}]'
export TG_BOT_TOKEN="your_bot_token"
export TG_CHAT_ID="your_chat_id"
export REPO_TOKEN="your_repo_token"  # 可选，用于自动更新 Secret

# 运行脚本
python scripts/auto_login.py
```

### 本地测试（修改为 headful 模式）

**Node.js 版本**:
编辑 [index.js:893](index.js#L893)：
```javascript
const { browser, page } = await connect({
  headless: false,  // 改为 false
  // ... 其他配置
});
```

**Python 版本**:
编辑 [scripts/auto_login.py:931](scripts/auto_login.py#L931)：
```python
# 将 headless=True 改为 headless=False
browser = p.chromium.launch(headless=False, args=['--no-sandbox'])
```

### GitHub Actions 触发

**Node.js 版本**:
- **自动运行**: cron 表达式 `"0 1 */5 * *"`（UTC 时间 01:00，每5天）
- **手动触发**: GitHub 仓库 → Actions → ClawCloud 自动登录 (Node.js) → Run workflow

**Python 版本**:
- **自动运行**: cron 表达式 `"0 1 */5 * *"`（UTC 时间 01:00，每5天）
- **手动触发**: GitHub 仓库 → Actions → ClawCloud 自动登录保活 → Run workflow

## 架构要点

### AutoLogin 类流程

1. **Cookie 预加载** ([scripts/auto_login.py:939-1030](scripts/auto_login.py#L939-L1030))
   - 优先使用 `GH_COOKIES`（JSON 数组格式或字符串格式）
   - 兼容旧的 `GH_SESSION`（单个 cookie）
   - 支持 `CLAW_COOKIES`（可选，避免重复登录）

2. **登录流程** ([scripts/auto_login.py:1032-1097](scripts/auto_login.py#L1032-L1097))
   - 访问 ClawCloud 登录页
   - 点击 GitHub OAuth 按钮
   - 处理 GitHub 登录（设备验证、2FA）
   - 等待重定向并自动检测区域

3. **区域检测** ([scripts/auto_login.py:297-337](scripts/auto_login.py#L297-L337))
   - 自动从子域名提取区域（如 `ap-southeast-1.console.claw.cloud`）
   - 后续保活操作使用检测到的区域 URL

4. **Cookie 更新** ([scripts/auto_login.py:1115-1129](scripts/auto_login.py#L1115-L1129))
   - 提取新的 GitHub Cookies 和 ClawCloud Cookies
   - 通过 `SecretUpdater` 自动更新 GitHub Secrets（需要 `REPO_TOKEN`）
   - 失败时通过 Telegram 发送 Cookies 供手动更新

### 关键类和组件

- **Telegram** ([scripts/auto_login.py:27-121](scripts/auto_login.py#L27-L121)): 通知和接收验证码（`wait_code` 方法监听 `/code 123456`）
- **GitHubReleases** ([scripts/auto_login.py:124-184](scripts/auto_login.py#L124-L184)): 上传截图到 Releases
- **SecretUpdater** ([scripts/auto_login.py:187-232](scripts/auto_login.py#L187-L232)): 使用 NaCl 加密更新 GitHub Secrets
- **AutoLogin** ([scripts/auto_login.py:235-1156](scripts/auto_login.py#L235-L1156)): 主逻辑类

### 2FA 验证流程

脚本支持三种验证方式（按优先级）：
1. **GitHub Mobile 批准** ([scripts/auto_login.py:520-567](scripts/auto_login.py#L520-L567)): 等待手机 App 批准，自动截图并发送验证数字到 Telegram
2. **TOTP 验证码** ([scripts/auto_login.py:569-701](scripts/auto_login.py#L569-L701)): 通过 Telegram 接收 `/code 123456` 命令，自动填入验证码
3. **Security Key 切换** ([scripts/auto_login.py:575-595](scripts/auto_login.py#L575-L595)): 如果检测到 Security Key 页面，自动切换到 Authenticator App

## 环境变量说明

**必需**:
- `GH_USERNAME`: GitHub 用户名
- `GH_PASSWORD`: GitHub 密码
- `TG_BOT_TOKEN`: Telegram Bot Token
- `TG_CHAT_ID`: Telegram Chat ID

**可选但推荐**:
- `GH_COOKIES`: GitHub Cookies（JSON 数组或字符串格式），避免重复登录
- `CLAW_COOKIES`: ClawCloud Cookies（可选）
- `REPO_TOKEN`: GitHub PAT（用于自动更新 Secrets，需要 `repo` 权限）
- `GH_TOKEN`: GitHub PAT（用于上传截图到 Releases，需要 `repo` 权限）
- `GH_REPO`: 目标仓库（格式: `username/repo`，默认使用 `GITHUB_REPOSITORY`）

**超时设置**:
- `TWO_FACTOR_WAIT`: 2FA 等待时间（秒，默认 120）
- `DEVICE_VERIFY_WAIT`: 设备验证等待时间（秒，默认 30，硬编码在脚本中）

## Cookie 格式

**JSON 数组格式（推荐）**:
```json
[{"name":"user_session","value":"xxx","domain":".github.com","path":"/","expires":-1,"httpOnly":false,"secure":true,"sameSite":"Lax"}]
```

**字符串格式**:
```
user_session=xxx; logged_in=yes; __Host-user_session_same_site=yyy
```

注意: `__Host-` 前缀的 cookie 必须使用精确域名（`github.com`），不能有前导点（[scripts/auto_login.py:958-968](scripts/auto_login.py#L958-L968)）

## Cloudflare WARP 支持

GitHub Actions 工作流会自动安装 Cloudflare WARP 并启用 IPv6 连接（[.github/workflows/keep-alive.yml:30-105](.github/workflows/keep-alive.yml#L30-L105)），用于测试需要 IPv6 的功能。

## 故障排除

1. **REGION_NOT_AVAILABLE 错误**:
   - **解决方案**: 使用 **Node.js 版本**（puppeteer-real-browser）避免检测
   - 如果 Python 版本遇到此错误，建议切换到 Node.js 版本

2. **登录失败**: 检查 GitHub Actions 日志中的截图（上传到 Releases）

3. **2FA 超时**: 确保 Telegram Bot 正常配置，检查 `TWO_FACTOR_WAIT` 设置

4. **Cookie 更新失败**: 确认 `REPO_TOKEN` 有 `repo` 权限

5. **区域检测错误**: 查看日志中的 "当前 URL"，手动检查区域子域名格式

6. **puppeteer-real-browser 相关**:
   - 确保 Node.js 版本 >= 18
   - Chromium 浏览器会自动通过 `npx puppeteer browsers install chromium` 安装
   - Cloudflare Turnstile 会自动处理（`turnstile: true`）

## 代码修改注意事项

- 修改登录流程时需要同步更新截图步骤编号（`shot` 方法调用）
- 修改超时时间需要同时更新环境变量读取和硬编码的默认值
- 添加新的环境变量需要在对应的工作流文件中配置：
  - **Node.js 版本**: [.github/workflows/keep-alive-nodejs.yml](.github/workflows/keep-alive-nodejs.yml)
  - **Python 版本**: [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml)

## 两个版本的主要差异

| 特性 | Node.js 版本 | Python 版本 |
|------|-------------|-------------|
| 框架 | puppeteer-real-browser | Playwright |
| 反检测能力 | ✅ 强（rebrowser 补丁） | ❌ 弱（易被检测） |
| Turnstile 支持 | ✅ 自动处理 | ❌ 需手动处理 |
| 鼠标模拟 | ✅ ghost-cursor | ❌ 无 |
| 运行环境 | Node.js 18+ | Python 3.8+ |
| 依赖大小 | ~300MB | ~400MB |

**建议**: 如果遇到 `REGION_NOT_AVAILABLE` 错误，**强烈推荐使用 Node.js 版本**。
