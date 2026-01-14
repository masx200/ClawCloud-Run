# ClawCloud 自动登录 - Node.js 版本

这是使用 **puppeteer-real-browser** 重写的 Node.js 版本，专门用于解决 **REGION_NOT_AVAILABLE** 检测问题。

## 为什么使用 Node.js 版本？

### 问题：REGION_NOT_AVAILABLE 错误

Python/Playwright 版本在使用时可能会遇到以下错误：

```
REGION_NOT_AVAILABLE - 区域不可用
```

这是因为 ClawCloud 检测到了自动化浏览器，拒绝了访问。

### 解决方案：puppeteer-real-browser

[puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser) 是一个专门为避免检测而设计的 Puppeteer 封装库：

✅ **rebrowser 补丁** - 修复了 Runtime.enable 等 CDP 指纹识别
✅ **真实鼠标模拟** - 使用 ghost-cursor 模拟人类鼠标行为
✅ **最小化补丁** - 以最自然的方式启动 Chrome
✅ **Cloudflare Turnstile** - 自动处理验证码
✅ **已验证可用** - 在多个高安全要求网站上测试通过

## 快速开始

### 1. 安装依赖

```bash
npm install
npx puppeteer browsers install chromium
```

### 2. 配置环境变量

在 GitHub Secrets 中配置以下变量：

**必需**：
- `GH_USERNAME` - GitHub 用户名
- `GH_PASSWORD` - GitHub 密码
- `TG_BOT_TOKEN` - Telegram Bot Token
- `TG_CHAT_ID` - Telegram Chat ID

**推荐**：
- `GH_COOKIES` - GitHub Cookies（避免重复登录）
- `CLAW_COOKIES` - ClawCloud Cookies（可选）
- `REPO_TOKEN` - GitHub PAT（自动更新 Secrets，需要 `repo` 权限）
- `GH_TOKEN` - GitHub PAT（上传截图到 Releases，需要 `repo` 权限）

### 3. 运行脚本

**本地测试**：
```bash
export GH_USERNAME="your_username"
export GH_PASSWORD="your_password"
export TG_BOT_TOKEN="your_bot_token"
export TG_CHAT_ID="your_chat_id"

node index.js
```

**GitHub Actions**：
推送代码后，在 GitHub 仓库 → Actions → ClawCloud 自动登录 (Node.js) → Run workflow

## 代码结构

```
.
├── index.js                          # 主脚本（Node.js 版本）
├── package.json                      # Node.js 依赖配置
├── .github/workflows/
│   └── keep-alive-nodejs.yml        # GitHub Actions 工作流
└── scripts/
    └── auto_login.py                # Python 版本（兼容）
```

## 核心功能

### 1. Cookie 管理

支持多种 Cookie 格式：

```javascript
// JSON 数组格式（推荐）
const cookies = [
  {name: "user_session", value: "xxx", domain: ".github.com", ...}
];

// 字符串格式
const cookies = "user_session=xxx; logged_in=yes";
```

### 2. 2FA 验证

支持三种验证方式：
- GitHub Mobile 批准
- TOTP 验证码（通过 Telegram 接收 `/code 123456`）
- 自动切换到 Authenticator App（如果检测到 Security Key）

### 3. 区域检测

自动从 URL 中提取区域：
```
https://ap-southeast-1.console.claw.cloud/ → ap-southeast-1
```

### 4. Telegram 通知

实时通知登录状态和错误信息，包括截图。

## GitHub Secrets 加密更新

脚本使用 NaCl 加密自动更新 GitHub Secrets：

```javascript
// 1. 获取公钥
const publicKey = await getPublicKey();

// 2. 加密 Secret
const encrypted = nacl.box(messageBytes, publicKey);

// 3. 更新到 GitHub
await updateSecret('GH_COOKIES', encrypted);
```

## 与 Python 版本的对比

| 特性 | Node.js 版本 | Python 版本 |
|------|-------------|-------------|
| 反检测能力 | ✅ 强 | ❌ 弱 |
| Turnstile | ✅ 自动处理 | ❌ 手动 |
| 检测问题 | ✅ 无 | ❌ REGION_NOT_AVAILABLE |
| 依赖大小 | ~300MB | ~400MB |
| 学习曲线 | 中等 | 低 |

## 故障排除

### 1. Chromium 安装失败

```bash
# 手动安装 Chromium
npx puppeteer browsers install chromium
```

### 2. Node.js 版本过低

确保 Node.js 版本 >= 18：
```bash
node --version
```

### 3. Cloudflare Turnstile 问题

脚本已启用 `turnstile: true`，会自动处理。如果仍有问题，可以尝试：
- 增加等待时间
- 使用代理（通过 `proxy` 参数）

### 4. 仍然被检测？

尝试以下方法：
1. 使用固定的 `userDataDir` 保持会话持久化
2. 添加更多浏览器参数（`args`）
3. 使用代理 IP

## 进阶配置

### 使用持久化用户数据

```javascript
const { browser, page } = await connect({
  customConfig: {
    userDataDir: './user-data-dir'  // 保持浏览器状态
  }
});
```

### 使用代理

```javascript
const { browser, page } = await connect({
  proxy: {
    host: 'proxy-host',
    port: 'proxy-port',
    username: 'proxy-username',
    password: 'proxy-password'
  }
});
```

### 自定义浏览器参数

```javascript
const { browser, page } = await connect({
  args: [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled'
  ]
});
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
