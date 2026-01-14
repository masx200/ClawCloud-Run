/**
 * ClawCloud 自动登录脚本 - Node.js 版本
 * 使用 puppeteer-real-browser 避免检测
 *
 * 核心功能:
 * - 自动检测区域跳转（如 ap-southeast-1.console.claw.cloud）
 * - 等待设备验证批准（30秒）
 * - 每次登录后自动更新 Cookie
 * - Telegram 通知
 */

import axios from 'axios';
import { connect } from 'puppeteer-real-browser';
import * as nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';

// ==================== 配置 ====================
const LOGIN_ENTRY_URL = 'https://console.run.claw.cloud';
const SIGNIN_URL = `${LOGIN_ENTRY_URL}/signin`;
const DEVICE_VERIFY_WAIT = 30; // Mobile验证 默认等 30 秒
const TWO_FACTOR_WAIT = parseInt(process.env.TWO_FACTOR_WAIT || '120'); // 2FA验证 默认等 120 秒

// ==================== 工具函数 ====================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg, level = 'INFO') {
  const icons = {
    'INFO': 'ℹ️',
    'SUCCESS': '✅',
    'ERROR': '❌',
    'WARN': '⚠️',
    'STEP': '🔹'
  };
  const line = `${icons[level] || '•'} ${msg}`;
  console.log(line);
  return line;
}

// ==================== Telegram 通知模块 ====================
class Telegram {
  constructor() {
    this.token = process.env.TG_BOT_TOKEN;
    this.chatId = process.env.TG_CHAT_ID;
    this.ok = !!(this.token && this.chatId);
    this.offset = 0;
  }

  async send(msg) {
    log(`[Telegram] 发送消息: ${msg}`, 'INFO');
    if (!this.ok) return;

    try {
      await axios.post(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          chat_id: this.chatId,
          text: msg,
          parse_mode: 'HTML'
        },
        { timeout: 30000 }
      );
    } catch (error) {
      console.error('Telegram 发送失败:', error.message);
    }
  }

  async photo(filePath, caption = '') {
    if (!this.ok || !fs.existsSync(filePath)) return;

    try {
      const formData = new FormData();
      formData.append('chat_id', this.chatId);
      formData.append('caption', caption.slice(0, 1024));
      formData.append('photo', fs.createReadStream(filePath));

      await axios.post(
        `https://api.telegram.org/bot${this.token}/sendPhoto`,
        formData,
        { timeout: 60000 }
      );
    } catch (error) {
      console.error('Telegram 发送图片失败:', error.message);
    }
  }

  async flushUpdates() {
    if (!this.ok) return 0;

    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${this.token}/getUpdates`,
        { timeout: 10000 }
      );

      const data = response.data;
      if (data.ok && data.result && data.result.length > 0) {
        return data.result[data.result.length - 1].update_id + 1;
      }
    } catch (error) {
      console.error('刷新 offset 失败:', error.message);
    }

    return 0;
  }

  async waitCode(timeout = TWO_FACTOR_WAIT) {
    if (!this.ok) return null;

    // 先刷新 offset，避免读到旧的 /code
    this.offset = await this.flushUpdates();
    const deadline = Date.now() + timeout * 1000;
    const pattern = /^\/code\s+(\d{6,8})$/;

    while (Date.now() < deadline) {
      try {
        const response = await axios.get(
          `https://api.telegram.org/bot${this.token}/getUpdates`,
          {
            params: { timeout: 20, offset: this.offset },
            timeout: 30000
          }
        );

        const data = response.data;
        if (!data.ok) {
          await sleep(2000);
          continue;
        }

        for (const upd of data.result || []) {
          this.offset = upd.update_id + 1;
          const msg = upd.message || {};
          const chat = msg.chat || {};

          if (String(chat.id) !== String(this.chatId)) continue;

          const text = (msg.text || '').trim();
          const match = pattern.exec(text);
          if (match) {
            return match[1];
          }
        }
      } catch (error) {
        console.error('获取 Telegram 更新失败:', error.message);
      }

      await sleep(2000);
    }

    return null;
  }
}

// ==================== GitHub Releases 上传模块 ====================
class GitHubReleases {
  constructor() {
    this.token = process.env.GH_TOKEN;
    this.repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
    this.tag = `screenshots_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    this.ok = !!(this.token && this.repo);

    if (this.ok) {
      log('✅ GitHub Releases 上传已启用', 'SUCCESS');
    } else {
      log('⚠️ GitHub Releases 上传未启用（需要 GH_TOKEN 和 GH_REPO）', 'WARN');
    }
  }

  async upload(filePath, name) {
    if (!this.ok || !fs.existsSync(filePath)) return null;

    const filename = name || path.basename(filePath);

    try {
      const headers = { Authorization: `token ${this.token}` };

      // 1. 确保 Release 存在
      let response = await axios.get(
        `https://api.github.com/repos/${this.repo}/releases/tags/${this.tag}`,
        { headers }
      );

      let uploadUrl;
      if (response.status === 404) {
        // 创建 Release
        const createResponse = await axios.post(
          `https://api.github.com/repos/${this.repo}/releases`,
          {
            tag_name: this.tag,
            name: this.tag,
            draft: false,
            prerelease: false
          },
          { headers }
        );

        if (createResponse.status !== 201) {
          log(`[GitHubReleases] 创建 Release 失败: ${createResponse.status}`, 'ERROR');
          return null;
        }

        uploadUrl = createResponse.data.upload_url.replace('{?name,label}', '');
      } else {
        uploadUrl = response.data.upload_url.replace('{?name,label}', '');
      }

      // 2. 上传文件
      const fileContent = fs.readFileSync(filePath);
      uploadUrl = `${uploadUrl}?name=${filename}`;
      headers['Content-Type'] = 'image/png';

      const uploadResponse = await axios.post(uploadUrl, fileContent, { headers });

      if (uploadResponse.status === 201) {
        return uploadResponse.data.browser_download_url;
      } else {
        log(`[GitHubReleases] 上传失败: ${uploadResponse.status}`, 'ERROR');
        return null;
      }
    } catch (error) {
      log(`[GitHubReleases] 上传异常: ${error.message}`, 'ERROR');
      return null;
    }
  }
}

// ==================== GitHub Secret 更新模块 ====================
class SecretUpdater {
  constructor() {
    this.token = process.env.REPO_TOKEN;
    this.repo = process.env.GITHUB_REPOSITORY;
    this.ok = !!(this.token && this.repo);

    if (this.ok) {
      log('✅ Secret 自动更新已启用', 'SUCCESS');
    } else {
      log('⚠️ Secret 自动更新未启用（需要 REPO_TOKEN）', 'WARN');
    }
  }

  async update(name, value) {
    if (!this.ok) return false;

    try {
      const headers = {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json'
      };

      // 获取公钥
      const keyResponse = await axios.get(
        `https://api.github.com/repos/${this.repo}/actions/secrets/public-key`,
        { headers, timeout: 30000 }
      );

      if (keyResponse.status !== 200) return false;

      const keyData = keyResponse.data;
      const publicKey = nacl.decodeBase64(keyData.key);

      // 加密
      const messageBytes = new TextEncoder().encode(value);
      const sealedBox = nacl.box.secretKeySeal(publicKey); // 使用更简单的方法
      const encrypted = nacl.box(messageBytes, sealedBox); // 这里需要调整

      // 临时方案：使用 node-jose 或其他库，这里先使用简化版本
      // 实际应该使用 tweetnacl-js 的正确方法
      const encryptedBase64 = Buffer.from(encrypted).toString('base64');

      // 更新 Secret
      const updateResponse = await axios.put(
        `https://api.github.com/repos/${this.repo}/actions/secrets/${name}`,
        {
          encrypted_value: encryptedBase64,
          key_id: keyData.key_id
        },
        { headers, timeout: 30000 }
      );

      return updateResponse.status === 201 || updateResponse.status === 204;
    } catch (error) {
      log(`更新 Secret 失败: ${error.message}`, 'ERROR');
      return false;
    }
  }
}

// ==================== AutoLogin 核心类 ====================
class AutoLogin {
  constructor() {
    this.username = process.env.GH_USERNAME;
    this.password = process.env.GH_PASSWORD;
    this.ghSession = (process.env.GH_SESSION || '').trim();
    this.ghCookies = (process.env.GH_COOKIES || '').trim();
    this.clawCookies = (process.env.CLAW_COOKIES || '').trim();
    this.tg = new Telegram();
    this.github = new GitHubReleases();
    this.secret = new SecretUpdater();
    this.shots = [];
    this.logs = [];
    this.n = 0;

    // 区域相关
    this.detectedRegion = null;
    this.regionBaseUrl = null;
  }

  log(msg, level = 'INFO') {
    const line = log(msg, level);
    this.logs.push(line);
  }

  async shot(page, name) {
    this.n++;
    const filename = `${String(this.n).padStart(2, '0')}_${name}.png`;
    try {
      await page.screenshot({ path: filename, fullPage: false });
      this.shots.push(filename);
    } catch (error) {
      console.error('截图失败:', error.message);
    }
    return filename;
  }

  async click(page, selectors, desc = '') {
    for (const sel of selectors) {
      try {
        // 检查是否是 XPath 选择器（以 // 开头）
        const isXPath = sel.trim().startsWith('//');

        if (isXPath) {
          // 使用 XPath
          const elements = await page.$x(sel);
          for (const el of elements) {
            const isVisible = await page.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }, el);

            if (isVisible) {
              await el.click();
              this.log(`已点击: ${desc}`, 'SUCCESS');
              return true;
            }
          }
        } else {
          // 使用 CSS 选择器
          const elements = await page.$$(sel);
          for (const el of elements) {
            const isVisible = await page.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }, el);

            if (isVisible) {
              await el.click();
              this.log(`已点击: ${desc}`, 'SUCCESS');
              return true;
            }
          }
        }
      } catch (error) {
        // 继续尝试下一个 selector
      }
    }

    // 如果上面的选择器都失败,尝试使用 page.evaluate 直接查找并点击
    try {
      const clicked = await page.evaluate(() => {
        // 查找所有包含 "GitHub" 文本的按钮
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));

        for (const btn of buttons) {
          const text = btn.textContent || '';
          if (text.includes('GitHub')) {
            const style = window.getComputedStyle(btn);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              btn.click();
              return true;
            }
          }
        }
        return false;
      });

      if (clicked) {
        this.log(`已点击: ${desc} (通过文本匹配)`, 'SUCCESS');
        return true;
      }
    } catch (error) {
      // 忽略错误
    }

    return false;
  }

  checkRegionNotAvailable(page) {
    // 这个方法需要在 page context 中执行
    return page.evaluate(() => {
      const url = window.location.href;

      // 检查 URL
      if (url.includes('REGION_NOT_AVAILABLE')) {
        return true;
      }

      // 检查页面文本
      if (document.body.innerHTML.includes('REGION_NOT_AVAILABLE')) {
        return true;
      }

      // 检查错误元素
      const errorSelectors = [
        '.flash-error',
        '.error-message',
        '[class*="error"]',
        '[role="alert"]'
      ];

      for (const sel of errorSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null && el.textContent.includes('REGION_NOT_AVAILABLE')) {
          return true;
        }
      }

      return false;
    });
  }

  detectRegion(url) {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname;

      // 检查是否是区域子域名格式
      // 格式: {region}.console.claw.cloud
      if (host.endsWith('.console.claw.cloud')) {
        const region = host.replace('.console.claw.cloud', '');
        if (region && region !== 'console') {
          this.detectedRegion = region;
          this.regionBaseUrl = `https://${host}`;
          this.log(`检测到区域: ${region}`, 'SUCCESS');
          this.log(`区域 URL: ${this.regionBaseUrl}`, 'INFO');
          return region;
        }
      }

      // 如果是主域名
      if (host.includes('console.run.claw.cloud') || host.includes('claw.cloud')) {
        this.log(`未检测到特定区域，使用当前域名: ${host}`, 'INFO');
        this.regionBaseUrl = `${urlObj.protocol}//${host}`;
        return null;
      }

      this.log(`使用当前 URL: ${url}`, 'INFO');
      this.regionBaseUrl = `${urlObj.protocol}//${host}`;
      return null;
    } catch (error) {
      this.log(`区域检测异常: ${error.message}`, 'WARN');
      return null;
    }
  }

  getBaseUrl() {
    return this.regionBaseUrl || LOGIN_ENTRY_URL;
  }

  async getGithubCookies(page) {
    try {
      const cookies = await page.cookies();
      const githubCookies = cookies.filter(c => c.domain.includes('github'));

      if (githubCookies.length > 0) {
        this.log(`提取到 ${githubCookies.length} 个 GitHub Cookies`, 'INFO');
        return JSON.stringify(githubCookies);
      }
    } catch (error) {
      this.log(`提取 GitHub Cookies 失败: ${error.message}`, 'WARN');
    }

    return null;
  }

  async getClawCookies(page) {
    try {
      const cookies = await page.cookies();
      const clawCookies = cookies.filter(c => c.domain.includes('claw.cloud'));

      if (clawCookies.length > 0) {
        return JSON.stringify(clawCookies);
      }
    } catch (error) {
      this.log(`提取 ClawCloud Cookies 失败: ${error.message}`, 'WARN');
    }

    return null;
  }

  async saveGithubCookies(value) {
    if (!value) return;

    this.log(`新 GitHub Cookies (${value.length} 字符)`, 'SUCCESS');

    // 自动更新 Secret
    if (await this.secret.update('GH_COOKIES', value)) {
      this.log('已自动更新 GH_COOKIES', 'SUCCESS');
      this.tg.send('🍪 <b>GitHub Cookies 已自动更新</b>\n\nGH_COOKIES 已保存');
    } else {
      // 通过 Telegram 发送
      this.tg.send(`🍪 <b>新 GitHub Cookies</b>\n\n请更新 Secret <b>GH_COOKIES</b> (点击查看):\n<tg-spoiler>${value}</tg-spoiler>`);
      this.log('已通过 Telegram 发送 GitHub Cookies', 'SUCCESS');
    }
  }

  async saveClawCookies(value) {
    if (!value) return;

    this.log(`新 ClawCloud Cookies (${value.length} 字符)`, 'SUCCESS');

    // 自动更新 Secret
    if (await this.secret.update('CLAW_COOKIES', value)) {
      this.log('已自动更新 CLAW_COOKIES', 'SUCCESS');
      this.tg.send('🍪 <b>ClawCloud Cookies 已自动更新</b>\n\nCLAW_COOKIES 已保存');
    } else {
      // 通过 Telegram 发送
      this.tg.send(`🍪 <b>新 ClawCloud Cookies</b>\n\n请更新 Secret <b>CLAW_COOKIES</b> (点击查看):\n<tg-spoiler>${value}</tg-spoiler>`);
      this.log('已通过 Telegram 发送 ClawCloud Cookies', 'SUCCESS');
    }
  }

  async waitDevice(page) {
    this.log(`需要设备验证，等待 ${DEVICE_VERIFY_WAIT} 秒...`, 'WARN');
    await this.shot(page, '设备验证');

    this.tg.send(`⚠️ <b>需要设备验证</b>\n\n请在 ${DEVICE_VERIFY_WAIT} 秒内批准：\n1️⃣ 检查邮箱点击链接\n2️⃣ 或在 GitHub App 批准`);

    if (this.shots.length > 0) {
      await this.tg.photo(this.shots[this.shots.length - 1], '设备验证页面');
    }

    for (let i = 0; i < DEVICE_VERIFY_WAIT; i++) {
      await sleep(1000);

      if (i % 5 === 0) {
        this.log(`  等待... (${i}/${DEVICE_VERIFY_WAIT}秒)`);
        const url = page.url();

        if (!url.includes('verified-device') && !url.includes('device-verification')) {
          this.log('设备验证通过！', 'SUCCESS');
          this.tg.send('✅ <b>设备验证通过</b>');
          return true;
        }

        try {
          await page.reload({ timeout: 10000 });
          await sleep(2000); // 等待网络空闲
        } catch (error) {
          // 忽略错误
        }
      }
    }

    const url = page.url();
    if (!url.includes('verified-device')) {
      return true;
    }

    this.log('设备验证超时', 'ERROR');
    this.tg.send('❌ <b>设备验证超时</b>');
    return false;
  }

  async waitTwoFactorMobile(page) {
    this.log(`需要两步验证（GitHub Mobile），等待 ${TWO_FACTOR_WAIT} 秒...`, 'WARN');

    // 先截图并立刻发出去
    const shot = await this.shot(page, '两步验证_mobile');
    this.tg.send(`⚠️ <b>需要两步验证（GitHub Mobile）</b>\n\n请打开手机 GitHub App 批准本次登录（会让你确认一个数字）。\n等待时间：${TWO_FACTOR_WAIT} 秒`);

    if (shot) {
      await this.tg.photo(shot, '两步验证页面（数字在图里）');
    }

    for (let i = 0; i < TWO_FACTOR_WAIT; i++) {
      await sleep(1000);

      const url = page.url();

      // 如果离开 two-factor 流程页面，认为通过
      if (!url.includes('github.com/sessions/two-factor/')) {
        this.log('两步验证通过！', 'SUCCESS');
        this.tg.send('✅ <b>两步验证通过</b>');
        return true;
      }

      // 如果被刷回登录页
      if (url.includes('github.com/login')) {
        this.log('两步验证后回到了登录页，需重新登录', 'ERROR');
        return false;
      }

      // 每 10 秒打印一次，并补发一次截图
      if (i % 10 === 0 && i !== 0) {
        this.log(`  等待... (${i}/${TWO_FACTOR_WAIT}秒)`);
        const shot = await this.shot(page, `两步验证_${i}s`);
        if (shot) {
          await this.tg.photo(shot, `两步验证页面（第${i}秒）`);
        }
      }

      // 只在 30 秒、60 秒... 做一次轻刷新
      if (i % 30 === 0 && i !== 0) {
        try {
          await page.reload({ timeout: 30000 });
          await sleep(1000); // 等待 DOM 加载
        } catch (error) {
          // 忽略错误
        }
      }
    }

    this.log('两步验证超时', 'ERROR');
    this.tg.send('❌ <b>两步验证超时</b>');
    return false;
  }

  async handle2FACodeInput(page) {
    this.log('需要输入验证码', 'WARN');
    const shot = await this.shot(page, '两步验证_code');

    // 如果是 Security Key 页面，尝试切换
    if (page.url().includes('two-factor/webauthn')) {
      this.log('检测到 Security Key 页面，尝试切换...', 'INFO');
      try {
        // 点击 "More options" - 使用 XPath
        const moreOptionsButton = await page.$x('//button[contains(text(), "More options")]');
        if (moreOptionsButton.length > 0) {
          await moreOptionsButton[0].click();
          this.log("已点击 'More options'", 'SUCCESS');
          await sleep(1000);
          await this.shot(page, '点击more_options后');

          // 点击 "Authenticator app"
          const authAppButton = await page.$x('//button[contains(text(), "Authenticator app")]');
          if (authAppButton.length > 0) {
            await authAppButton[0].click();
            this.log("已选择 'Authenticator app'", 'SUCCESS');
            await sleep(2000);
            await sleep(2000); // 等待网络空闲
            await this.shot(page, '切换到验证码输入页');
          }
        }
      } catch (error) {
        this.log(`切换验证方式时出错: ${error.message}`, 'WARN');
      }
    }

    // 发送提示并等待验证码
    this.tg.send(`🔐 <b>需要验证码登录</b>\n\n用户${this.username}正在登录，请在 Telegram 里发送：\n<code>/code 你的6位验证码</code>\n\n等待时间：${TWO_FACTOR_WAIT} 秒`);

    if (shot) {
      await this.tg.photo(shot, '两步验证页面');
    }

    this.log(`等待验证码（${TWO_FACTOR_WAIT}秒）...`, 'WARN');
    const code = await this.tg.waitCode(TWO_FACTOR_WAIT);

    if (!code) {
      this.log('等待验证码超时', 'ERROR');
      this.tg.send('❌ <b>等待验证码超时</b>');
      return false;
    }

    this.log('收到验证码，正在填入...', 'SUCCESS');
    this.tg.send('✅ 收到验证码，正在填入...');

    // 尝试填入验证码
    const selectors = [
      'input[autocomplete="one-time-code"]',
      'input[name="app_otp"]',
      'input[name="otp"]',
      'input#app_totp',
      'input#otp',
      'input[inputmode="numeric"]'
    ];

    for (const sel of selectors) {
      try {
        const input = await page.$(sel);
        if (input) {
          await input.click(); // 先点击输入框
          await input.type(code); // 使用 type 而不是 fill
          this.log('已填入验证码', 'SUCCESS');
          await sleep(1000);

          // 点击 Verify 或按 Enter
          let submitted = false;

          // 尝试通过 XPath 找到 Verify 按钮
          const verifyButtons = await page.$x('//button[contains(text(), "Verify") or contains(text(), "verify")]');
          if (verifyButtons.length > 0) {
            await verifyButtons[0].click();
            submitted = true;
            this.log('已点击 Verify 按钮 (XPath)', 'SUCCESS');
          }

          // 如果没找到，尝试标准选择器
          if (!submitted) {
            const verifySelectors = [
              'button[type="submit"]',
              'input[type="submit"]'
            ];

            for (const btnSel of verifySelectors) {
              const btn = await page.$(btnSel);
              if (btn) {
                await btn.click();
                submitted = true;
                this.log('已点击 Verify 按钮', 'SUCCESS');
                break;
              }
            }
          }

          if (!submitted) {
            await page.keyboard.press('Enter');
            this.log('已按 Enter 提交', 'SUCCESS');
          }

          await sleep(3000);
          await sleep(2000); // 等待网络空闲
          await this.shot(page, '验证码提交后');

          // 检查是否通过
          if (!page.url().includes('github.com/sessions/two-factor/')) {
            this.log('验证码验证通过！', 'SUCCESS');
            this.tg.send('✅ <b>验证码验证通过</b>');
            return true;
          } else {
            this.log('验证码可能错误', 'ERROR');
            this.tg.send('❌ <b>验证码可能错误，请检查后重试</b>');
            return false;
          }
        }
      } catch (error) {
        // 继续尝试下一个 selector
      }
    }

    this.log('没找到验证码输入框', 'ERROR');
    this.tg.send('❌ <b>没找到验证码输入框</b>');
    return false;
  }

  async loginGithub(page) {
    this.log('登录 GitHub...', 'STEP');
    await this.shot(page, 'github_登录页');

    try {
      // Puppeteer 使用 type 而不是 fill
      await page.type('input[name="login"]', this.username);
      await page.type('input[name="password"]', this.password);
      this.log('已输入凭据');
    } catch (error) {
      this.log(`输入失败: ${error.message}`, 'ERROR');
      return false;
    }

    await this.shot(page, 'github_已填写');

    try {
      const submitButton = await page.$('input[type="submit"], button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
      }
    } catch (error) {
      // 忽略
    }

    await sleep(3000);
    await sleep(2000); // 等待网络空闲
    await this.shot(page, 'github_登录后');

    const url = page.url();
    this.log(`当前: ${url}`);

    // 设备验证
    if (url.includes('verified-device') || url.includes('device-verification')) {
      if (!await this.waitDevice(page)) {
        return false;
      }
      await sleep(2000);
      await sleep(2000); // 等待网络空闲
      await this.shot(page, '验证后');
    }

    // 2FA
    if (url.includes('two-factor')) {
      this.log('需要两步验证！', 'WARN');
      await this.shot(page, '两步验证');

      // GitHub Mobile
      if (url.includes('two-factor/mobile')) {
        if (!await this.waitTwoFactorMobile(page)) {
          return false;
        }
        try {
          await sleep(2000); // 等待网络空闲
          await sleep(2000);
        } catch (error) {
          // 忽略
        }
      } else {
        // TOTP 验证码
        if (!await this.handle2FACodeInput(page)) {
          return false;
        }
        try {
          await sleep(2000); // 等待网络空闲
          await sleep(2000);
        } catch (error) {
          // 忽略
        }
      }
    }

    // 检查错误
    try {
      const errorElement = await page.$('.flash-error');
      if (errorElement) {
        const errorText = await errorElement.textContent();
        this.log(`错误: ${errorText}`, 'ERROR');
        return false;
      }
    } catch (error) {
      // 忽略
    }

    return true;
  }

  async oauth(page) {
    if (page.url().includes('github.com/login/oauth/authorize')) {
      this.log('处理 OAuth...', 'STEP');
      await this.shot(page, 'oauth');
      await this.click(page, ['button[name="authorize"]'], '授权');
      await sleep(3000);
      await sleep(2000); // 等待网络空闲
    }
  }

  async waitRedirect(page, wait = 60) {
    this.log('等待重定向...', 'STEP');

    for (let i = 0; i < wait; i++) {
      const url = page.url();

      // 检查是否出现区域不可用错误
      if (await this.checkRegionNotAvailable(page)) {
        this.log('检测到 REGION_NOT_AVAILABLE 错误，登录失败！', 'ERROR');
        return false;
      }

      // 检查是否已跳转到 claw.cloud
      if (url.includes('claw.cloud') && !url.toLowerCase().includes('signin')) {
        this.log('重定向成功！', 'SUCCESS');

        // 检测并记录区域
        this.detectRegion(url);

        return true;
      }

      if (url.includes('github.com/login/oauth/authorize')) {
        await this.oauth(page);
      }

      await sleep(1000);
      if (i % 10 === 0) {
        this.log(`  等待... (${i}秒)`);
      }
    }

    this.log('重定向超时', 'ERROR');
    return false;
  }

  async keepalive(page) {
    this.log('保活...', 'STEP');

    const baseUrl = this.getBaseUrl();
    this.log(`使用区域 URL: ${baseUrl}`, 'INFO');

    const pagesToVisit = [
      [`${baseUrl}/`, '控制台'],
      [`${baseUrl}/apps`, '应用']
    ];

    if (this.detectedRegion) {
      this.log(`当前区域: ${this.detectedRegion}`, 'INFO');
    }

    for (const [url, name] of pagesToVisit) {
      try {
        await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        await sleep(2000); // 等待网络空闲

        // 检查区域不可用错误
        if (await this.checkRegionNotAvailable(page)) {
          this.log(`访问 ${name} 时发现区域不可用`, 'ERROR');
          throw new Error('REGION_NOT_AVAILABLE');
        }

        this.log(`已访问: ${name} (${url})`, 'SUCCESS');

        // 再次检测区域
        const currentUrl = page.url();
        if (currentUrl.includes('claw.cloud')) {
          this.detectRegion(currentUrl);
        }

        await sleep(2000);
      } catch (error) {
        if (error.message === 'REGION_NOT_AVAILABLE') {
          this.log(`访问 ${name} 失败: 区域不可用`, 'ERROR');
          throw error;
        }
        this.log(`访问 ${name} 失败: ${error.message}`, 'WARN');
      }
    }

    await this.shot(page, '完成');
  }

  async uploadShots() {
    if (this.shots.length === 0) {
      this.log('没有截图需要上传', 'WARN');
      return;
    }

    if (!this.github.ok) {
      this.log('未配置 GitHub Token 或 Repo，跳过上传', 'WARN');
      return;
    }

    this.log(`开始上传 ${this.shots.length} 个截图到 GitHub Releases...`, 'INFO');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const urls = [];

    for (const shot of this.shots) {
      const newName = `${timestamp}_${shot}`;
      const url = await this.github.upload(shot, newName);
      if (url) {
        urls.push(url);
        this.log(`✓ ${shot} -> ${url}`, 'SUCCESS');
      }
    }

    if (urls.length > 0) {
      this.log(`成功上传 ${urls.length} 个截图到 GitHub Releases`, 'SUCCESS');
      const msg = '📸 截图已上传到 GitHub Releases:\n' + urls.slice(0, 10).map(u => `• ${u}`).join('\n');
      if (urls.length > 10) {
        msg += `\n... 还有 ${urls.length - 10} 个`;
      }
      this.tg.send(msg);
    } else {
      this.log('上传截图失败', 'ERROR');
    }
  }

  cleanupShots() {
    for (const shot of this.shots) {
      try {
        if (fs.existsSync(shot)) {
          fs.unlinkSync(shot);
        }
      } catch (error) {
        // 忽略
      }
    }
  }

  async notify(success, error = '') {
    if (!this.tg.ok) return;

    const regionInfo = this.detectedRegion ? `\n<b>区域:</b> ${this.detectedRegion}` : '';

    let msg = `<b>🤖 ClawCloud 自动登录</b>\n\n<b>状态:</b> ${success ? '✅ 成功' : '❌ 失败'}\n<b>用户:</b> ${this.username}${regionInfo}\n<b>时间:</b> ${new Date().toLocaleString('zh-CN')}`;

    if (error) {
      msg += `\n<b>错误:</b> ${error}`;
    }

    msg += '\n\n<b>日志:</b>\n' + this.logs.slice(-6).join('\n');

    this.tg.send(msg);

    if (this.shots.length > 0) {
      if (!success) {
        for (const shot of this.shots.slice(-3)) {
          await this.tg.photo(shot, shot);
        }
      } else {
        await this.tg.photo(this.shots[this.shots.length - 1], '完成');
      }
    }
  }

  async loadCookies(page) {
    // 使用 puppeteer 标准的 page.setCookie() API
    // Cookie 会自动保存到 userDataDir

    try {
      // 预加载 GitHub Cookies
      if (this.ghCookies) {
        try {
          let cookies;

          // 尝试解析 JSON 格式
          if (this.ghCookies.startsWith('[')) {
            cookies = JSON.parse(this.ghCookies);
          } else {
            // 解析 Cookie 字符串格式
            cookies = [];
            for (const item of this.ghCookies.split(';')) {
              const [name, value] = item.split('=').map(s => s.trim());
              if (name && value) {
                if (name.startsWith('__Host-')) {
                  cookies.push({
                    name,
                    value,
                    url: 'https://github.com'
                  });
                } else {
                  cookies.push({
                    name,
                    value,
                    url: 'https://github.com'
                  });
                }
              }
            }
          }

          if (cookies.length > 0) {
            // 标准化 Cookie 对象（只使用 url 参数，避免与 domain 冲突）
            const normalizedCookies = cookies.map(cookie => {
              const normalized = {
                name: cookie.name,
                value: cookie.value,
                url: 'https://github.com',
                path: cookie.path || '/',
                httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : false,
                secure: true,
                sameSite: cookie.sameSite || 'Lax'
              };

              // 处理 expires 字段（只有当是有效时间戳时才设置）
              if (cookie.expires && typeof cookie.expires === 'number' && cookie.expires > 0) {
                normalized.expires = cookie.expires;
              }

              return normalized;
            });

            // 使用 page.setCookie() 设置 Cookies
            await page.setCookie(...normalizedCookies);
            this.log(`已加载 ${normalizedCookies.length} 个 GitHub Cookies`, 'SUCCESS');
          }
        } catch (error) {
          this.log(`加载 GitHub Cookies 失败: ${error.message}`, 'WARN');
        }
      } else if (this.ghSession) {
        // 兼容旧的 GH_SESSION
        try {
          await page.setCookie(
            {
              name: 'user_session',
              value: this.ghSession,
              url: 'https://github.com',
              path: '/',
              secure: true,
              sameSite: 'Lax'
            },
            {
              name: 'logged_in',
              value: 'yes',
              url: 'https://github.com',
              path: '/',
              secure: true,
              sameSite: 'Lax'
            }
          );
          this.log('已加载 GitHub Session Cookie (旧格式)', 'SUCCESS');
        } catch (error) {
          this.log('加载 GitHub Cookie 失败', 'WARN');
        }
      }

      // 预加载 ClawCloud Cookies
      if (this.clawCookies) {
        try {
          let cookies;

          if (this.clawCookies.startsWith('[')) {
            cookies = JSON.parse(this.clawCookies);
          } else {
            cookies = [];
            const domain = process.env.CLAW_COOKIE_DOMAIN || '.run.claw.cloud';
            for (const item of this.clawCookies.split(';')) {
              const [name, value] = item.split('=').map(s => s.trim());
              if (name && value) {
                cookies.push({
                  name,
                  value,
                  domain,
                  path: '/',
                  httpOnly: false,
                  secure: true,
                  sameSite: 'Lax'
                });
              }
            }
          }

          if (cookies.length > 0) {
            // 标准化 Cookie 对象
            const normalizedCookies = cookies.map(cookie => {
              const normalized = {
                name: cookie.name,
                value: cookie.value,
                url: 'https://run.claw.cloud',
                path: cookie.path || '/',
                httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : false,
                secure: true,
                sameSite: cookie.sameSite || 'Lax'
              };

              // 处理 expires 字段
              if (cookie.expires && typeof cookie.expires === 'number' && cookie.expires > 0) {
                normalized.expires = cookie.expires;
              }

              return normalized;
            });

            // 使用 page.setCookie() 设置 Cookies
            await page.setCookie(...normalizedCookies);
            this.log(`已加载 ${normalizedCookies.length} 个 ClawCloud Cookies`, 'SUCCESS');
          }
        } catch (error) {
          this.log(`加载 ClawCloud Cookies 失败: ${error.message}`, 'WARN');
        }
      }
    } catch (error) {
      this.log(`加载 Cookies 时出错: ${error.message}`, 'WARN');
    }
  }

  async run() {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 ClawCloud 自动登录 (puppeteer-real-browser)');
    console.log('='.repeat(50) + '\n');

    this.log(`用户名: ${this.username}`);
    this.log(`GitHub Cookies: ${this.ghCookies ? '有' : (this.ghSession ? '有(旧格式)' : '无')}`);
    this.log(`ClawCloud Cookies: ${this.clawCookies ? '有' : '无'}`);
    this.log(`密码: ${this.password ? '有' : '无'}`);
    this.log(`登录入口: ${LOGIN_ENTRY_URL}`);

    if (!this.username || !this.password) {
      this.log('缺少凭据', 'ERROR');
      await this.notify(false, '凭据未配置');
      process.exit(1);
    }

    // 确保 chrome-user-data 目录存在
    const userDataDir = './chrome-user-data';
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      this.log(`已创建用户数据目录: ${userDataDir}`, 'INFO');
    }

    // 使用 puppeteer-real-browser
    const { browser, page } = await connect({
      headless: false,  // 使用有界面模式（需要指定 Chrome 路径）
      args: ['--no-sandbox'],
      turnstile: true,
      customConfig: {
        headless: false,
        // 使用本地 Chrome 浏览器
        chromePath: 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
        // 设置用户数据目录，用于持久化登录状态和 Cookies
        userDataDir: userDataDir,
        // 其他浏览器配置
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1920,1080'
        ]
      },
      connectOption: {
        defaultViewport: { width: 1920, height: 1080 }
      }
    });

    try {
      // 预加载 Cookies
      await this.loadCookies(page);

      // 1. 访问 ClawCloud 登录入口
      this.log('步骤1: 打开 ClawCloud 登录页', 'STEP');
      await page.goto(SIGNIN_URL, { timeout: 60000, waitUntil: 'networkidle0' });
      await sleep(2000);
      await this.shot(page, 'clawcloud');

      const currentUrl = page.url();
      this.log(`当前 URL: ${currentUrl}`);

      // 2. 点击 GitHub
      this.log('步骤2: 点击 GitHub', 'STEP');
      if (!await this.click(page, [
        '//button[.//text()[contains(., "GitHub")]]',
        '//button[contains(@class, "chakra-button") and contains(text(), "GitHub")]',
        '//button[.//svg][contains(text(), "GitHub")]',
        '[data-provider="github"]',
        '//button[contains(text(), "GitHub") or contains(@aria-label, "GitHub")]',
        '//a[contains(text(), "GitHub") or contains(@aria-label, "GitHub")]',
        '//div[contains(@role, "button") and contains(text(), "GitHub")]',
        'button[type="submit"]'
      ], 'GitHub')) {
        this.log('找不到按钮', 'ERROR');
        await this.notify(false, '找不到 GitHub 按钮');
        process.exit(1);
      }

      await sleep(3000);
      await sleep(2000); // 等待网络空闲
      await this.shot(page, '点击后');
      const url = page.url();
      this.log(`当前: ${url}`);

      // 检查是否已经登录
      if (!url.toLowerCase().includes('signin') && url.includes('claw.cloud') && !url.includes('github.com')) {
        // 检查区域不可用错误
        if (await this.checkRegionNotAvailable(page)) {
          await this.shot(page, '区域不可用');
          await this.notify(false, 'REGION_NOT_AVAILABLE - 区域不可用');
          process.exit(1);
        }

        this.log('已登录！', 'SUCCESS');
        this.detectRegion(url);
        await this.keepalive(page);

        // 提取并保存 Cookies
        const ghCookies = await this.getGithubCookies(page);
        if (ghCookies) {
          await this.saveGithubCookies(ghCookies);
        }

        const clawCookies = await this.getClawCookies(page);
        if (clawCookies) {
          await this.saveClawCookies(clawCookies);
        }

        await this.notify(true);
        console.log('\n✅ 成功！\n');
        return;
      }

      // 3. GitHub 登录
      this.log('步骤3: GitHub 认证', 'STEP');

      if (url.includes('github.com/login') || url.includes('github.com/session')) {
        if (!await this.loginGithub(page)) {
          await this.shot(page, '登录失败');
          await this.notify(false, 'GitHub 登录失败');
          process.exit(1);
        }
      } else if (url.includes('github.com/login/oauth/authorize')) {
        this.log('Cookie 有效', 'SUCCESS');
        await this.oauth(page);
      }

      // 4. 等待重定向
      this.log('步骤4: 等待重定向', 'STEP');
      if (!await this.waitRedirect(page)) {
        await this.shot(page, '重定向失败');
        await this.notify(false, '重定向失败');
        process.exit(1);
      }

      await this.shot(page, '重定向成功');

      // 5. 验证
      this.log('步骤5: 验证', 'STEP');
      const finalUrl = page.url();

      // 检查区域不可用错误
      if (await this.checkRegionNotAvailable(page)) {
        await this.shot(page, '区域不可用');
        await this.notify(false, 'REGION_NOT_AVAILABLE - 区域不可用');
        process.exit(1);
      }

      if (!finalUrl.includes('claw.cloud') || finalUrl.toLowerCase().includes('signin')) {
        await this.notify(false, '验证失败');
        process.exit(1);
      }

      // 再次确认区域检测
      if (!this.detectedRegion) {
        this.detectRegion(finalUrl);
      }

      // 6. 保活
      await this.keepalive(page);

      // 7. 提取并保存 GitHub Cookies
      this.log('步骤6: 更新 GitHub Cookies', 'STEP');
      const ghCookies = await this.getGithubCookies(page);
      if (ghCookies) {
        await this.saveGithubCookies(ghCookies);
      } else {
        this.log('未获取到新 GitHub Cookies', 'WARN');
      }

      // 8. 提取并保存 ClawCloud Cookies
      this.log('步骤7: 更新 ClawCloud Cookies', 'STEP');
      const clawCookies = await this.getClawCookies(page);
      if (clawCookies) {
        await this.saveClawCookies(clawCookies);
      } else {
        this.log('未获取到新 ClawCloud Cookies', 'WARN');
      }

      await this.notify(true);
      console.log('\n' + '='.repeat(50));
      console.log('✅ 成功！');
      if (this.detectedRegion) {
        console.log(`📍 区域: ${this.detectedRegion}`);
      }
      console.log('='.repeat(50) + '\n');

    } catch (error) {
      this.log(`异常: ${error.message}`, 'ERROR');
      await this.shot(page, '异常');
      console.error(error);
      await this.notify(false, error.message);
      process.exit(1);
    } finally {
      // 上传截图
      try {
        await this.uploadShots();
      } catch (error) {
        this.log(`上传截图时出错: ${error.message}`, 'ERROR');
      }

      // 清理截图
      this.cleanupShots();

      await browser.close();
    }
  }
}

// ==================== 主入口 ====================
if (import.meta.main) {
  new AutoLogin().run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default AutoLogin;
