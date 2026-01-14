"""
ClawCloud 自动登录脚本
- 自动检测区域跳转（如 ap-southeast-1.console.claw.cloud）
- 等待设备验证批准（30秒）
- 每次登录后自动更新 Cookie
- Telegram 通知
"""

import base64
import os
import re
import sys
import time
from urllib.parse import urlparse

import requests
from playwright.sync_api import sync_playwright

# ==================== 配置 ====================
# 固定登录入口，OAuth后会自动跳转到实际区域
LOGIN_ENTRY_URL = "https://console.run.claw.cloud"
SIGNIN_URL = f"{LOGIN_ENTRY_URL}/signin"
DEVICE_VERIFY_WAIT = 30  # Mobile验证 默认等 30 秒
TWO_FACTOR_WAIT = int(os.environ.get("TWO_FACTOR_WAIT", "120"))  # 2FA验证 默认等 120 秒


class Telegram:
    """Telegram 通知"""
    
    def __init__(self):
        self.token = os.environ.get('TG_BOT_TOKEN')
        self.chat_id = os.environ.get('TG_CHAT_ID')
        self.ok = bool(self.token and self.chat_id)
    
    def send(self, msg):
        print(f"[Telegram][INFO] 发送消息: {msg}")
        if not self.ok:
            return
        try:
            requests.post(
                f"https://api.telegram.org/bot{self.token}/sendMessage",
                data={"chat_id": self.chat_id, "text": msg, "parse_mode": "HTML"},
                timeout=30
            )
        except:
            pass
    
    def photo(self, path, caption=""):
        if not self.ok or not os.path.exists(path):
            return
        try:
            with open(path, 'rb') as f:
                requests.post(
                    f"https://api.telegram.org/bot{self.token}/sendPhoto",
                    data={"chat_id": self.chat_id, "caption": caption[:1024]},
                    files={"photo": f},
                    timeout=60
                )
        except:
            pass
    
    def flush_updates(self):
        """刷新 offset 到最新，避免读到旧消息"""
        if not self.ok:
            return 0
        try:
            r = requests.get(
                f"https://api.telegram.org/bot{self.token}/getUpdates",
                params={"timeout": 0},
                timeout=10
            )
            data = r.json()
            if data.get("ok") and data.get("result"):
                return data["result"][-1]["update_id"] + 1
        except:
            pass
        return 0
    
    def wait_code(self, timeout=120):
        """
        等待你在 TG 里发 /code 123456
        只接受来自 TG_CHAT_ID 的消息
        """
        if not self.ok:
            return None
        
        # 先刷新 offset，避免读到旧的 /code
        offset = self.flush_updates()
        deadline = time.time() + timeout
        pattern = re.compile(r"^/code\s+(\d{6,8})$")  # 6位TOTP 或 8位恢复码也行
        
        while time.time() < deadline:
            try:
                r = requests.get(
                    f"https://api.telegram.org/bot{self.token}/getUpdates",
                    params={"timeout": 20, "offset": offset},
                    timeout=30
                )
                data = r.json()
                if not data.get("ok"):
                    time.sleep(2)
                    continue
                
                for upd in data.get("result", []):
                    offset = upd["update_id"] + 1
                    msg = upd.get("message") or {}
                    chat = msg.get("chat") or {}
                    if str(chat.get("id")) != str(self.chat_id):
                        continue
                    
                    text = (msg.get("text") or "").strip()
                    m = pattern.match(text)
                    if m:
                        return m.group(1)
            
            except Exception:
                pass
            
            time.sleep(2)
        
        return None


class GitHubReleases:
    """GitHub Releases 上传器"""
    
    def __init__(self):
        self.token = os.environ.get('GH_TOKEN')
        self.repo = os.environ.get('GH_REPO', os.environ.get('GITHUB_REPOSITORY'))
        self.tag =  f'screenshots_{time.strftime("%Y%m%d_%H%M%S")}'
        
        
        #""" os.environ.get('GH_RELEASE_TAG', """#)
        self.ok = bool(self.token and self.repo)
        if self.ok:
            print("✅ GitHub Releases 上传已启用")
        else:
            print("⚠️ GitHub Releases 上传未启用（需要 GH_TOKEN 和 GH_REPO）")
    
    def upload(self, path, name=None):
        """上传单个文件到 Releases"""
        if not self.ok or not os.path.exists(path):
            return None
        
        filename = name or os.path.basename(path)
        
        try:
            # 1. 确保 Release 存在
            url = f"https://api.github.com/repos/{self.repo}/releases/tags/{self.tag}"
            headers = {"Authorization": f"token {self.token}"}
            resp = requests.get(url, headers=headers)
            
            if resp.status_code == 404:
                # 创建 Release
                create_url = f"https://api.github.com/repos/{self.repo}/releases"
                data = {
                    "tag_name": self.tag,
                    "name": self.tag,
                    "draft": False,
                    "prerelease": False
                }
                resp = requests.post(create_url, json=data, headers=headers)
                if resp.status_code != 201:
                    print(f"[GitHubReleases][ERROR] 创建 Release 失败: {resp.status_code}")
                    return None
                upload_url = resp.json()['upload_url'].replace("{?name,label}", "")
            else:
                upload_url = resp.json()['upload_url'].replace("{?name,label}", "")
            
            # 2. 上传文件
            with open(path, 'rb') as f:
                upload_url_with_name = f"{upload_url}?name={filename}"
                headers["Content-Type"] = "image/png"
                resp = requests.post(upload_url_with_name, data=f, headers=headers)
            
            if resp.status_code == 201:
                return resp.json()['browser_download_url']
            else:
                print(f"[GitHubReleases][ERROR] 上传失败: {resp.status_code}")
                return None
                
        except Exception as e:
            print(f"[GitHubReleases][ERROR] 上传异常: {e}")
            return None


class SecretUpdater:
    """GitHub Secret 更新器"""
    
    def __init__(self):
        self.token = os.environ.get('REPO_TOKEN')
        self.repo = os.environ.get('GITHUB_REPOSITORY')
        self.ok = bool(self.token and self.repo)
        if self.ok:
            print("✅ Secret 自动更新已启用")
        else:
            print("⚠️ Secret 自动更新未启用（需要 REPO_TOKEN）")
    
    def update(self, name, value):
        if not self.ok:
            return False
        try:
            from nacl import encoding, public
            
            headers = {
                "Authorization": f"token {self.token}",
                "Accept": "application/vnd.github.v3+json"
            }
            
            # 获取公钥
            r = requests.get(
                f"https://api.github.com/repos/{self.repo}/actions/secrets/public-key",
                headers=headers, timeout=30
            )
            if r.status_code != 200:
                return False
            
            key_data = r.json()
            pk = public.PublicKey(key_data['key'].encode(), encoding.Base64Encoder())
            encrypted = public.SealedBox(pk).encrypt(value.encode())
            
            # 更新 Secret
            r = requests.put(
                f"https://api.github.com/repos/{self.repo}/actions/secrets/{name}",
                headers=headers,
                json={"encrypted_value": base64.b64encode(encrypted).decode(), "key_id": key_data['key_id']},
                timeout=30
            )
            return r.status_code in [201, 204]
        except Exception as e:
            print(f"更新 Secret 失败: {e}")
            return False


class AutoLogin:
    """自动登录"""

    username: str | None
    password: str | None
    gh_session: str
    gh_cookies: str  # 新增：支持多个 GitHub cookies
    claw_cookies: str
    tg: Telegram
    github: 'GitHubReleases'
    secret: 'SecretUpdater'
    shots: list[str]
    logs: list[str]
    n: int
    detected_region: str | None
    region_base_url: str | None

    def __init__(self):
        self.username = os.environ.get('GH_USERNAME')
        self.password = os.environ.get('GH_PASSWORD')
        self.gh_session = os.environ.get('GH_SESSION', '').strip()
        self.gh_cookies = os.environ.get('GH_COOKIES', '').strip()  # 新增：支持多个 GitHub cookies
        self.claw_cookies = os.environ.get('CLAW_COOKIES', '').strip()
        self.tg = Telegram()
        self.github = GitHubReleases()  # GitHub Releases 上传器
        self.secret = SecretUpdater()
        self.shots = []
        self.logs = []
        self.n = 0

        # 区域相关
        self.detected_region = None  # 检测到的区域，如 "ap-southeast-1"
        self.region_base_url = None  # 检测到的区域基础 URL
        
    def log(self, msg, level="INFO"):
        icons = {"INFO": "ℹ️", "SUCCESS": "✅", "ERROR": "❌", "WARN": "⚠️", "STEP": "🔹"}
        line = f"{icons.get(level, '•')} {msg}"
        print(line)
        self.logs.append(line)
    
    def shot(self, page, name):
        self.n += 1
        f = f"{self.n:02d}_{name}.png"
        try:
            page.screenshot(path=f)
            self.shots.append(f)
        except:
            pass
        return f
    
    def click(self, page, sels, desc=""):
        for s in sels:
            try:
                el = page.locator(s).first
                if el.is_visible(timeout=3000):
                    el.click()
                    self.log(f"已点击: {desc}", "SUCCESS")
                    return True
            except:
                pass
        return False

    def check_region_not_available(self, page):
        """检查页面是否出现 REGION_NOT_AVAILABLE 错误"""
        try:
            # 检查页面 URL
            if 'REGION_NOT_AVAILABLE' in page.url:
                return True

            # 检查页面文本内容
            page_content = page.content()
            if 'REGION_NOT_AVAILABLE' in page_content:
                return True

            # 检查常见的错误提示元素
            error_selectors = [
                '.flash-error',
                '.error-message',
                '[class*="error"]',
                '[role="alert"]'
            ]

            for selector in error_selectors:
                try:
                    el = page.locator(selector).first
                    if el.is_visible(timeout=2000):
                        text = el.inner_text()
                        if 'REGION_NOT_AVAILABLE' in text:
                            return True
                except:
                    pass

        except Exception as e:
            self.log(f"检查 REGION_NOT_AVAILABLE 时出错: {e}", "WARN")

        return False
    
    def detect_region(self, url):
        """
        从 URL 中检测区域信息
        例如: https://ap-southeast-1.console.claw.cloud/... -> ap-southeast-1
        """
        try:
            parsed = urlparse(url)
            host = parsed.netloc  # 如 "ap-southeast-1.console.claw.cloud"
            
            # 检查是否是区域子域名格式
            # 格式: {region}.console.claw.cloud
            if host.endswith('.console.claw.cloud'):
                region = host.replace('.console.claw.cloud', '')
                if region and region != 'console':  # 排除无效情况
                    self.detected_region = region
                    self.region_base_url = f"https://{host}"
                    self.log(f"检测到区域: {region}", "SUCCESS")
                    self.log(f"区域 URL: {self.region_base_url}", "INFO")
                    return region
            
            # 如果是主域名 console.run.claw.cloud，可能还没跳转
            if 'console.run.claw.cloud' in host or 'claw.cloud' in host:
                # 尝试从路径或其他地方提取区域信息
                # 有些平台可能在路径中包含区域，如 /region/ap-southeast-1/...
                path = parsed.path
                region_match = re.search(r'/(?:region|r)/([a-z]+-[a-z]+-\d+)', path)
                if region_match:
                    region = region_match.group(1)
                    self.detected_region = region
                    self.region_base_url = f"https://{region}.console.claw.cloud"
                    self.log(f"从路径检测到区域: {region}", "SUCCESS")
                    return region
            
            self.log(f"未检测到特定区域，使用当前域名: {host}", "INFO")
            # 如果没有检测到区域，使用当前 URL 的基础部分
            self.region_base_url = f"{parsed.scheme}://{parsed.netloc}"
            return None
            
        except Exception as e:
            self.log(f"区域检测异常: {e}", "WARN")
            return None
    
    def get_base_url(self):
        """获取当前应该使用的基础 URL"""
        if self.region_base_url:
            return self.region_base_url
        return LOGIN_ENTRY_URL
    
    def get_session(self, context):
        """提取 GitHub Session Cookie"""
        try:
            for c in context.cookies():
                if c['name'] == 'user_session' and 'github' in c.get('domain', ''):
                    return c['value']
        except:
            pass
        return None

    def get_github_cookies(self, context):
        """提取所有 GitHub Cookies"""
        try:
            import json
            cookies = []
            for c in context.cookies():
                # 只提取 github.com 相关的 cookies
                if 'github' in c.get('domain', ''):
                    # 清理 sameSite 值，确保是 Playwright 接受的格式
                    same_site = c.get('sameSite', 'None')
                    if same_site not in ['None', 'Lax', 'Strict']:
                        same_site = 'None'

                    # 清理 expires 值
                    expires = c.get('expires', -1)
                    if expires is None:
                        expires = -1

                    cookies.append({
                        'name': c['name'],
                        'value': c['value'],
                        'domain': c['domain'],
                        'path': c.get('path', '/'),
                        'expires': expires,
                        'httpOnly': c.get('httpOnly', False),
                        'secure': c.get('secure', True),
                        'sameSite': same_site
                    })
            if cookies:
                self.log(f"提取到 {len(cookies)} 个 GitHub Cookies", "INFO")
                return json.dumps(cookies)
        except Exception as e:
            self.log(f"提取 GitHub Cookies 失败: {e}", "WARN")
        return None

    def get_claw_cookies(self, context):
        """提取所有 ClawCloud Cookie"""
        try:
            import json
            cookies = []
            for c in context.cookies():
                # 只提取 claw.cloud 相关的 cookies
                if 'claw.cloud' in c.get('domain', ''):
                    # 清理 sameSite 值
                    same_site = c.get('sameSite', 'None')
                    if same_site not in ['None', 'Lax', 'Strict']:
                        same_site = 'None'

                    # 清理 expires 值
                    expires = c.get('expires', -1)
                    if expires is None:
                        expires = -1

                    cookies.append({
                        'name': c['name'],
                        'value': c['value'],
                        'domain': c['domain'],
                        'path': c.get('path', '/'),
                        'expires': expires,
                        'httpOnly': c.get('httpOnly', False),
                        'secure': c.get('secure', True),
                        'sameSite': same_site
                    })
            if cookies:
                return json.dumps(cookies)
        except Exception as e:
            self.log(f"提取 ClawCloud Cookies 失败: {e}", "WARN")
        return None
    
    def save_cookie(self, value):
        """保存新 GitHub Cookie（已废弃，兼容旧版本）"""
        if not value:
            return

        self.log(f"新 Cookie: {value[:15]}...{value[-8:]}", "SUCCESS")

        # 自动更新 Secret
        if self.secret.update('GH_SESSION', value):
            self.log("已自动更新 GH_SESSION", "SUCCESS")
            self.tg.send("🔑 <b>Cookie 已自动更新</b>\n\nGH_SESSION 已保存")
        else:
            # 通过 Telegram 发送
            self.tg.send(f"""🔑 <b>新 Cookie</b>

请更新 Secret <b>GH_SESSION</b> (点击查看):
<tg-spoiler>{value}</tg-spoiler>
""")
            self.log("已通过 Telegram 发送 Cookie", "SUCCESS")

    def save_github_cookies(self, value):
        """保存所有 GitHub Cookies"""
        if not value:
            return

        self.log(f"新 GitHub Cookies ({len(value)} 字符)", "SUCCESS")

        # 自动更新 Secret
        if self.secret.update('GH_COOKIES', value):
            self.log("已自动更新 GH_COOKIES", "SUCCESS")
            self.tg.send("🍪 <b>GitHub Cookies 已自动更新</b>\n\nGH_COOKIES 已保存")
        else:
            # 通过 Telegram 发送
            self.tg.send(f"""🍪 <b>新 GitHub Cookies</b>

请更新 Secret <b>GH_COOKIES</b> (点击查看):
<tg-spoiler>{value}</tg-spoiler>
""")
            self.log("已通过 Telegram 发送 GitHub Cookies", "SUCCESS")

    def save_claw_cookies(self, value):
        """保存 ClawCloud Cookies"""
        if not value:
            return

        self.log(f"新 ClawCloud Cookies ({len(value)} 字符)", "SUCCESS")

        # 自动更新 Secret
        if self.secret.update('CLAW_COOKIES', value):
            self.log("已自动更新 CLAW_COOKIES", "SUCCESS")
            self.tg.send("🍪 <b>ClawCloud Cookies 已自动更新</b>\n\nCLAW_COOKIES 已保存")
        else:
            # 通过 Telegram 发送
            self.tg.send(f"""🍪 <b>新 ClawCloud Cookies</b>

请更新 Secret <b>CLAW_COOKIES</b> (点击查看):
<tg-spoiler>{value}</tg-spoiler>
""")
            self.log("已通过 Telegram 发送 ClawCloud Cookies", "SUCCESS")
    
    def wait_device(self, page):
        """等待设备验证"""
        self.log(f"需要设备验证，等待 {DEVICE_VERIFY_WAIT} 秒...", "WARN")
        self.shot(page, "设备验证")
        
        self.tg.send(f"""⚠️ <b>需要设备验证</b>

请在 {DEVICE_VERIFY_WAIT} 秒内批准：
1️⃣ 检查邮箱点击链接
2️⃣ 或在 GitHub App 批准""")
        
        if self.shots:
            self.tg.photo(self.shots[-1], "设备验证页面")
        
        for i in range(DEVICE_VERIFY_WAIT):
            time.sleep(1)
            if i % 5 == 0:
                self.log(f"  等待... ({i}/{DEVICE_VERIFY_WAIT}秒)")
                url = page.url
                if 'verified-device' not in url and 'device-verification' not in url:
                    self.log("设备验证通过！", "SUCCESS")
                    self.tg.send("✅ <b>设备验证通过</b>")
                    return True
                try:
                    page.reload(timeout=10000)
                    page.wait_for_load_state('networkidle', timeout=10000)
                except:
                    pass
        
        if 'verified-device' not in page.url:
            return True
        
        self.log("设备验证超时", "ERROR")
        self.tg.send("❌ <b>设备验证超时</b>")
        return False
    
    def wait_two_factor_mobile(self, page):
        """等待 GitHub Mobile 两步验证批准，并把数字截图提前发到电报"""
        self.log(f"需要两步验证（GitHub Mobile），等待 {TWO_FACTOR_WAIT} 秒...", "WARN")
        
        # 先截图并立刻发出去（让你看到数字）
        shot = self.shot(page, "两步验证_mobile")
        self.tg.send(f"""⚠️ <b>需要两步验证（GitHub Mobile）</b>

请打开手机 GitHub App 批准本次登录（会让你确认一个数字）。
等待时间：{TWO_FACTOR_WAIT} 秒""")
        if shot:
            self.tg.photo(shot, "两步验证页面（数字在图里）")
        
        # 不要频繁 reload，避免把流程刷回登录页
        for i in range(TWO_FACTOR_WAIT):
            time.sleep(1)
            
            url = page.url
            
            # 如果离开 two-factor 流程页面，认为通过
            if "github.com/sessions/two-factor/" not in url:
                self.log("两步验证通过！", "SUCCESS")
                self.tg.send("✅ <b>两步验证通过</b>")
                return True
            
            # 如果被刷回登录页，说明这次流程断了（不要硬等）
            if "github.com/login" in url:
                self.log("两步验证后回到了登录页，需重新登录", "ERROR")
                return False
            
            # 每 10 秒打印一次，并补发一次截图（防止你没看到数字）
            if i % 10 == 0 and i != 0:
                self.log(f"  等待... ({i}/{TWO_FACTOR_WAIT}秒)")
                shot = self.shot(page, f"两步验证_{i}s")
                if shot:
                    self.tg.photo(shot, f"两步验证页面（第{i}秒）")
            
            # 只在 30 秒、60 秒... 做一次轻刷新（可选，频率很低）
            if i % 30 == 0 and i != 0:
                try:
                    page.reload(timeout=30000)
                    page.wait_for_load_state('domcontentloaded', timeout=30000)
                except:
                    pass
        
        self.log("两步验证超时", "ERROR")
        self.tg.send("❌ <b>两步验证超时</b>")
        return False
    
    def handle_2fa_code_input(self, page):
        """处理 TOTP 验证码输入（通过 Telegram 发送 /code 123456）"""
        self.log("需要输入验证码", "WARN")
        shot = self.shot(page, "两步验证_code")

        # 如果是 Security Key (webauthn) 页面，尝试切换到 Authenticator App
        if 'two-factor/webauthn' in page.url:
            self.log("检测到 Security Key 页面，尝试切换...", "INFO")
            try:
                # 点击 "More options"
                more_options_button = page.locator('button:has-text("More options")').first
                if more_options_button.is_visible(timeout=3000):
                    more_options_button.click()
                    self.log("已点击 'More options'", "SUCCESS")
                    time.sleep(1) # 等待菜单出现
                    self.shot(page, "点击more_options后")

                    # 点击 "Authenticator app"
                    auth_app_button = page.locator('button:has-text("Authenticator app")').first
                    if auth_app_button.is_visible(timeout=2000):
                        auth_app_button.click()
                        self.log("已选择 'Authenticator app'", "SUCCESS")
                        time.sleep(2)
                        page.wait_for_load_state('networkidle', timeout=15000)
                        shot = self.shot(page, "切换到验证码输入页") # 更新截图
            except Exception as e:
                self.log(f"切换验证方式时出错: {e}", "WARN")

        # (保留) 先尝试点击"Use an authentication app"或类似按钮（如果在 mobile 页面）
        try:
            more_options = [
                'a:has-text("Use an authentication app")',
                'a:has-text("Enter a code")',
                'button:has-text("Use an authentication app")',
                'button:has-text("Authenticator app")',
                '[href*="two-factor/app"]'
            ]
            for sel in more_options:
                try:
                    el = page.locator(sel).first
                    if el.is_visible(timeout=2000):
                        el.click()
                        time.sleep(2)
                        page.wait_for_load_state('networkidle', timeout=15000)
                        self.log("已切换到验证码输入页面", "SUCCESS")
                        shot = self.shot(page, "两步验证_code_切换后")
                        break
                except:
                    pass
        except:
            pass

        # 发送提示并等待验证码
        self.tg.send(f"""🔐 <b>需要验证码登录</b>

用户{self.username}正在登录，请在 Telegram 里发送：
<code>/code 你的6位验证码</code>

等待时间：{TWO_FACTOR_WAIT} 秒""")
        if shot:
            self.tg.photo(shot, "两步验证页面")

        self.log(f"等待验证码（{TWO_FACTOR_WAIT}秒）...", "WARN")
        code = self.tg.wait_code(timeout=TWO_FACTOR_WAIT)

        if not code:
            self.log("等待验证码超时", "ERROR")
            self.tg.send("❌ <b>等待验证码超时</b>")
            return False

        # 不打印验证码明文，只提示收到
        self.log("收到验证码，正在填入...", "SUCCESS")
        self.tg.send("✅ 收到验证码，正在填入...")

        # 常见 OTP 输入框 selector（优先级排序）
        selectors = [
            'input[autocomplete="one-time-code"]',
            'input[name="app_otp"]',
            'input[name="otp"]',
            'input#app_totp',
            'input#otp',
            'input[inputmode="numeric"]'
        ]

        for sel in selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    el.fill(code)
                    self.log(f"已填入验证码", "SUCCESS")
                    time.sleep(1)

                    # 优先点击 Verify 按钮，不行再 Enter
                    submitted = False
                    verify_btns = [
                        'button:has-text("Verify")',
                        'button[type="submit"]',
                        'input[type="submit"]'
                    ]
                    for btn_sel in verify_btns:
                        try:
                            btn = page.locator(btn_sel).first
                            if btn.is_visible(timeout=1000):
                                btn.click()
                                submitted = True
                                self.log("已点击 Verify 按钮", "SUCCESS")
                                break
                        except:
                            pass

                    if not submitted:
                        page.keyboard.press("Enter")
                        self.log("已按 Enter 提交", "SUCCESS")

                    time.sleep(3)
                    page.wait_for_load_state('networkidle', timeout=30000)
                    self.shot(page, "验证码提交后")

                    # 检查是否通过
                    if "github.com/sessions/two-factor/" not in page.url:
                        self.log("验证码验证通过！", "SUCCESS")
                        self.tg.send("✅ <b>验证码验证通过</b>")
                        return True
                    else:
                        self.log("验证码可能错误", "ERROR")
                        self.tg.send("❌ <b>验证码可能错误，请检查后重试</b>")
                        return False
            except:
                pass

        self.log("没找到验证码输入框", "ERROR")
        self.tg.send("❌ <b>没找到验证码输入框</b>")
        return False
    
    def login_github(self, page, context):
        """登录 GitHub"""
        self.log("登录 GitHub...", "STEP")
        self.shot(page, "github_登录页")
        
        try:
            page.locator('input[name="login"]').fill(self.username)
            page.locator('input[name="password"]').fill(self.password)
            self.log("已输入凭据")
        except Exception as e:
            self.log(f"输入失败: {e}", "ERROR")
            return False
        
        self.shot(page, "github_已填写")
        
        try:
            page.locator('input[type="submit"], button[type="submit"]').first.click()
        except:
            pass
        
        time.sleep(3)
        page.wait_for_load_state('networkidle', timeout=30000)
        self.shot(page, "github_登录后")
        
        url = page.url
        self.log(f"当前: {url}")
        
        # 设备验证
        if 'verified-device' in url or 'device-verification' in url:
            if not self.wait_device(page):
                return False
            time.sleep(2)
            page.wait_for_load_state('networkidle', timeout=30000)
            self.shot(page, "验证后")
        
        # 2FA
        if 'two-factor' in page.url:
            self.log("需要两步验证！", "WARN")
            self.shot(page, "两步验证")
            
            # GitHub Mobile：等待你在手机上批准
            if 'two-factor/mobile' in page.url:
                if not self.wait_two_factor_mobile(page):
                    return False
                # 通过后等页面稳定
                try:
                    page.wait_for_load_state('networkidle', timeout=30000)
                    time.sleep(2)
                except:
                    pass
            
            else:
                # 其它两步验证方式（TOTP/恢复码等），尝试通过 Telegram 输入验证码
                if not self.handle_2fa_code_input(page):
                    return False
                # 通过后等页面稳定
                try:
                    page.wait_for_load_state('networkidle', timeout=30000)
                    time.sleep(2)
                except:
                    pass
        
        # 错误
        try:
            err = page.locator('.flash-error').first
            if err.is_visible(timeout=2000):
                self.log(f"错误: {err.inner_text()}", "ERROR")
                return False
        except:
            pass
        
        return True
    
    def oauth(self, page):
        """处理 OAuth"""
        if 'github.com/login/oauth/authorize' in page.url:
            self.log("处理 OAuth...", "STEP")
            self.shot(page, "oauth")
            self.click(page, ['button[name="authorize"]', 'button:has-text("Authorize")'], "授权")
            time.sleep(3)
            page.wait_for_load_state('networkidle', timeout=30000)
    
    def wait_redirect(self, page, wait=60):
        """等待重定向并检测区域"""
        self.log("等待重定向...", "STEP")
        for i in range(wait):
            url = page.url

            # 检查是否出现区域不可用错误
            if self.check_region_not_available(page):
                self.log("检测到 REGION_NOT_AVAILABLE 错误，登录失败！", "ERROR")
                return False

            # 检查是否已跳转到 claw.cloud
            if 'claw.cloud' in url and 'signin' not in url.lower():
                self.log("重定向成功！", "SUCCESS")

                # 检测并记录区域
                self.detect_region(url)

                return True

            if 'github.com/login/oauth/authorize' in url:
                self.oauth(page)

            time.sleep(1)
            if i % 10 == 0:
                self.log(f"  等待... ({i}秒)")

        self.log("重定向超时", "ERROR")
        return False
    
    def keepalive(self, page):
        """保活 - 使用检测到的区域 URL"""
        self.log("保活...", "STEP")

        # 使用检测到的区域 URL，如果没有则使用默认
        base_url = self.get_base_url()
        self.log(f"使用区域 URL: {base_url}", "INFO")

        pages_to_visit = [
            (f"{base_url}/", "控制台"),
            (f"{base_url}/apps", "应用"),
        ]

        # 如果检测到了区域，可以额外访问一些区域特定页面
        if self.detected_region:
            self.log(f"当前区域: {self.detected_region}", "INFO")

        for url, name in pages_to_visit:
            try:
                page.goto(url, timeout=30000)
                page.wait_for_load_state('networkidle', timeout=15000)

                # 检查区域不可用错误
                if self.check_region_not_available(page):
                    self.log(f"访问 {name} 时发现区域不可用", "ERROR")
                    raise Exception("REGION_NOT_AVAILABLE")

                self.log(f"已访问: {name} ({url})", "SUCCESS")

                # 再次检测区域（以防中途跳转）
                current_url = page.url
                if 'claw.cloud' in current_url:
                    self.detect_region(current_url)

                time.sleep(2)
            except Exception as e:
                if 'REGION_NOT_AVAILABLE' in str(e):
                    self.log(f"访问 {name} 失败: 区域不可用", "ERROR")
                    raise
                self.log(f"访问 {name} 失败: {e}", "WARN")

        self.shot(page, "完成")
    
    def upload_shots(self):
        """上传所有截图到 GitHub Releases"""
        if not self.shots:
            self.log("没有截图需要上传", "WARN")
            return
        
        if not self.github.ok:
            self.log("未配置 GitHub Token 或 Repo，跳过上传", "WARN")
            return
        
        self.log(f"开始上传 {len(self.shots)} 个截图到 GitHub Releases...", "INFO")
        
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        urls = []
        
        for shot in self.shots:
            # 添加时间戳前缀
            new_name = f"{timestamp}_{shot}"
            url = self.github.upload(shot, new_name)
            if url:
                urls.append(url)
                self.log(f"✓ {shot} -> {url}", "SUCCESS")
        
        if urls:
            self.log(f"成功上传 {len(urls)} 个截图到 GitHub Releases", "SUCCESS")
            # 将 URL 添加到 Telegram 通知
            msg = f"📸 截图已上传到 GitHub Releases:\n" + "\n".join([f"• {u}" for u in urls[:10]])
            if len(urls) > 10:
                msg += f"\n... 还有 {len(urls) - 10} 个"
            self.tg.send(msg)
        else:
            self.log("上传截图失败", "ERROR")
    
    def cleanup_shots(self):
        """清理本地截图文件"""
        for f in self.shots:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except:
                pass
        
    def notify(self, ok, err=""):
        if not self.tg.ok:
            return
        
        region_info = f"\n<b>区域:</b> {self.detected_region or '默认'}" if self.detected_region else ""
        
        msg = f"""<b>🤖 ClawCloud 自动登录</b>

<b>状态:</b> {"✅ 成功" if ok else "❌ 失败"}
<b>用户:</b> {self.username}{region_info}
<b>时间:</b> {time.strftime('%Y-%m-%d %H:%M:%S')}"""
        
        if err:
            msg += f"\n<b>错误:</b> {err}"
        
        msg += "\n\n<b>日志:</b>\n" + "\n".join(self.logs[-6:])
        
        self.tg.send(msg)
        
        if self.shots:
            if not ok:
                for s in self.shots[-3:]:
                    self.tg.photo(s, s)
            else:
                # for s in self.shots[-3:]:
                #     self.tg.photo(s, s)
                self.tg.photo(self.shots[-1], "完成")
    
    def run(self):
        print("\n" + "="*50)
        print("🚀 ClawCloud 自动登录")
        print("="*50 + "\n")
        
        self.log(f"用户名: {self.username}")
        self.log(f"GitHub Cookies: {'有' if self.gh_cookies else ('有(旧格式)' if self.gh_session else '无')}")
        self.log(f"ClawCloud Cookies: {'有' if self.claw_cookies else '无'}")
        self.log(f"密码: {'有' if self.password else '无'}")
        self.log(f"登录入口: {LOGIN_ENTRY_URL}")
        
        if not self.username or not self.password:
            self.log("缺少凭据", "ERROR")
            self.notify(False, "凭据未配置")
            sys.exit(1)
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            context = browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
            page = context.new_page()
            
            try:
                # 预加载 GitHub Cookies
                if self.gh_cookies:
                    try:
                        import json
                        cookies = []

                        # 尝试解析 JSON 格式
                        if self.gh_cookies.startswith('['):
                            cookies = json.loads(self.gh_cookies)
                        else:
                            # 解析 Cookie 字符串格式 (name=value; name2=value2; ...)
                            for item in self.gh_cookies.split(';'):
                                item = item.strip()
                                if '=' in item:
                                    name, value = item.split('=', 1)
                                    name = name.strip()
                                    value = value.strip()

                                    # __Host- 前缀的 cookie 有特殊要求
                                    if name.startswith('__Host-'):
                                        cookies.append({
                                            'name': name,
                                            'value': value,
                                            'domain': 'github.com',  # 精确域名，不能有前导点
                                            'path': '/',
                                            'expires': -1,
                                            'httpOnly': False,
                                            'secure': True,  # 必须是 True
                                            'sameSite': 'None'
                                        })
                                    else:
                                        cookies.append({
                                            'name': name,
                                            'value': value,
                                            'domain': '.github.com',  # 可以有前导点
                                            'path': '/',
                                            'expires': -1,
                                            'httpOnly': False,
                                            'secure': True,
                                            'sameSite': 'Lax'
                                        })

                        if cookies:
                            context.add_cookies(cookies)
                            self.log(f"已加载 {len(cookies)} 个 GitHub Cookies", "SUCCESS")
                    except Exception as e:
                        self.log(f"加载 GitHub Cookies 失败: {e}", "WARN")

                # 兼容旧的 GH_SESSION 环境变量
                elif self.gh_session:
                    try:
                        context.add_cookies([
                            {'name': 'user_session', 'value': self.gh_session, 'domain': 'github.com', 'path': '/'},
                            {'name': 'logged_in', 'value': 'yes', 'domain': 'github.com', 'path': '/'}
                        ])
                        self.log("已加载 GitHub Session Cookie (旧格式)", "SUCCESS")
                    except:
                        self.log("加载 GitHub Cookie 失败", "WARN")

                # 预加载 ClawCloud Cookies
                if self.claw_cookies:
                    try:
                        import json
                        cookies = []

                        # 尝试解析 JSON 格式
                        if self.claw_cookies.startswith('['):
                            cookies = json.loads(self.claw_cookies)
                        else:
                            # 解析 Cookie 字符串格式 (name=value; name2=value2; ...)
                            for item in self.claw_cookies.split(';'):
                                item = item.strip()
                                if '=' in item:
                                    name, value = item.split('=', 1)
                                    # 尝试从环境变量获取域名，或使用默认域名
                                    domain = os.environ.get('CLAW_COOKIE_DOMAIN', '.run.claw.cloud')
                                    cookies.append({
                                        'name': name.strip(),
                                        'value': value.strip(),
                                        'domain': domain,
                                        'path': '/',
                                        'expires': -1,
                                        'httpOnly': False,
                                        'secure': True,
                                        'sameSite': 'Lax'
                                    })

                        if cookies:
                            context.add_cookies(cookies)
                            self.log(f"已加载 {len(cookies)} 个 ClawCloud Cookies", "SUCCESS")
                    except Exception as e:
                        self.log(f"加载 ClawCloud Cookies 失败: {e}", "WARN")
                
                # 1. 访问 ClawCloud 登录入口
                self.log("步骤1: 打开 ClawCloud 登录页", "STEP")
                page.goto(SIGNIN_URL, timeout=60000)
                page.wait_for_load_state('networkidle', timeout=60000)
                time.sleep(2)
                self.shot(page, "clawcloud")
                
                # 检查当前 URL，可能已经自动跳转到区域
                current_url = page.url
                self.log(f"当前 URL: {current_url}")
  
            
               # 2. 点击 GitHub
                self.log("步骤2: 点击 GitHub", "STEP")
                if not self.click(page, [
                    'button:has-text("GitHub")',
                    'a:has-text("GitHub")',
                    '[data-provider="github"]'
                ], "GitHub"):
                    self.log("找不到按钮", "ERROR")
                    self.notify(False, "找不到 GitHub 按钮")
                    sys.exit(1)
                
                time.sleep(3)
                page.wait_for_load_state('networkidle', timeout=120000)
                self.shot(page, "点击后")
                url = page.url
                self.log(f"当前: {url}")

                if 'signin' not in url.lower() and 'claw.cloud' in url and  'github.com' not in url:
                    # 检查区域不可用错误
                    if self.check_region_not_available(page):
                        self.shot(page, "区域不可用")
                        self.notify(False, "REGION_NOT_AVAILABLE - 区域不可用")
                        sys.exit(1)

                    self.log("已登录！", "SUCCESS")
                    # 检测区域
                    self.detect_region(url)
                    self.keepalive(page)
                    # 提取并保存所有 GitHub Cookies
                    gh_cookies = self.get_github_cookies(context)
                    if gh_cookies:
                        self.save_github_cookies(gh_cookies)
                    # 提取并保存 ClawCloud Cookies
                    claw_cookies = self.get_claw_cookies(context)
                    if claw_cookies:
                        self.save_claw_cookies(claw_cookies)
                    self.notify(True)
                    print("\n✅ 成功！\n")
                    return
                

                
                # 3. GitHub 登录
                self.log("步骤3: GitHub 认证", "STEP")
                
                if 'github.com/login' in url or 'github.com/session' in url:
                    if not self.login_github(page, context):
                        self.shot(page, "登录失败")
                        self.notify(False, "GitHub 登录失败")
                        sys.exit(1)
                elif 'github.com/login/oauth/authorize' in url:
                    self.log("Cookie 有效", "SUCCESS")
                    self.oauth(page)
                
                # 4. 等待重定向（会自动检测区域）
                self.log("步骤4: 等待重定向", "STEP")
                if not self.wait_redirect(page):
                    self.shot(page, "重定向失败")
                    self.notify(False, "重定向失败")
                    sys.exit(1)
                
                self.shot(page, "重定向成功")
                
                # 5. 验证
                self.log("步骤5: 验证", "STEP")
                current_url = page.url

                # 检查区域不可用错误
                if self.check_region_not_available(page):
                    self.shot(page, "区域不可用")
                    self.notify(False, "REGION_NOT_AVAILABLE - 区域不可用")
                    sys.exit(1)

                if 'claw.cloud' not in current_url or 'signin' in current_url.lower():
                    self.notify(False, "验证失败")
                    sys.exit(1)
                
                # 再次确认区域检测
                if not self.detected_region:
                    self.detect_region(current_url)
                
                # 6. 保活（使用检测到的区域 URL）
                self.keepalive(page)

                # 7. 提取并保存所有 GitHub Cookies
                self.log("步骤6: 更新 GitHub Cookies", "STEP")
                gh_cookies = self.get_github_cookies(context)
                if gh_cookies:
                    self.save_github_cookies(gh_cookies)
                else:
                    self.log("未获取到新 GitHub Cookies", "WARN")

                # 8. 提取并保存 ClawCloud Cookies
                self.log("步骤7: 更新 ClawCloud Cookies", "STEP")
                claw_cookies = self.get_claw_cookies(context)
                if claw_cookies:
                    self.save_claw_cookies(claw_cookies)
                else:
                    self.log("未获取到新 ClawCloud Cookies", "WARN")
                
                self.notify(True)
                print("\n" + "="*50)
                print("✅ 成功！")
                if self.detected_region:
                    print(f"📍 区域: {self.detected_region}")
                print("="*50 + "\n")
                
            except Exception as e:
                self.log(f"异常: {e}", "ERROR")
                self.shot(page, "异常")
                import traceback
                traceback.print_exc()
                self.notify(False, str(e))
                sys.exit(1)
            finally:
                # 上传截图到 GitHub Releases
                try:
                    self.upload_shots()
                except Exception as e:
                    self.log(f"上传截图时出错: {e}", "ERROR")
                
                # 清理本地截图
                self.cleanup_shots()
                
                browser.close()


if __name__ == "__main__":
    AutoLogin().run()
