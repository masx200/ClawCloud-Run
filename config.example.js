/**
 * 配置文件示例
 * 复制此文件为 config.local.js 并修改配置
 */

export default {
  // Chrome 浏览器路径
  // Windows 示例:
  chromePath: 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',

  // Linux 示例:
  // chromePath: '/usr/bin/google-chrome',

  // macOS 示例:
  // chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

  // 用户数据目录（用于持久化登录状态和 Cookies）
  userDataDir: './chrome-user-data',

  // 浏览器配置
  browserConfig: {
    headless: false,  // false = 有界面模式, true = 无头模式
    viewport: {
      width: 1920,
      height: 1080
    },
    // 额外的浏览器参数
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080'
    ]
  },

  // 登录配置
  login: {
    // 登录入口
    loginEntryUrl: 'https://console.run.claw.cloud',

    // 设备验证等待时间（秒）
    deviceVerifyWait: 30,

    // 2FA 等待时间（秒）
    twoFactorWait: 120
  }
};
