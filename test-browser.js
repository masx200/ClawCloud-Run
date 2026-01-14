/**
 * 测试脚本 - 验证 puppeteer-real-browser 基本功能
 */

import { connect } from 'puppeteer-real-browser';

async function test() {
  console.log('测试 puppeteer-real-browser...\n');

  try {
    const { browser, page } = await connect({
      headless: false,
      turnstile: true,
      customConfig: {
        headless: false,
        chromePath: 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir: './chrome-user-data-test',
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      }
    });

    console.log('✅ 浏览器启动成功');

    // 测试导航
    await page.goto('https://github.com', { waitUntil: 'domcontentloaded' });
    console.log('✅ 导航到 GitHub 成功');

    // 测试 XPath
    const title = await page.title();
    console.log(`✅ 页面标题: ${title}`);

    // 测试 XPath 选择器
    const buttons = await page.$x('//button[contains(text(), "Sign")]');
    console.log(`✅ 找到 ${buttons.length} 个包含 "Sign" 的按钮`);

    await sleep(3000);

    await browser.close();
    console.log('\n✅ 所有测试通过！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test();
