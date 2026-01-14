/**
 * 全局类型定义
 */

declare namespace NodeJS {
  interface ProcessEnv {
    GH_USERNAME: string;
    GH_PASSWORD: string;
    GH_COOKIES?: string;
    GH_SESSION?: string;
    CLAW_COOKIES?: string;
    TG_BOT_TOKEN: string;
    TG_CHAT_ID: string;
    GH_TOKEN?: string;
    GH_REPO?: string;
    GITHUB_REPOSITORY?: string;
    REPO_TOKEN?: string;
    TWO_FACTOR_WAIT?: string;
    CLAW_COOKIE_DOMAIN?: string;
  }
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure: boolean;
  sameSite?: 'None' | 'Lax' | 'Strict';
}
