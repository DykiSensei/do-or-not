# 撸还是不撸 🎰

> 长久以来困扰人类的终极问题：今天，**撸还是不撸**？
> 把它交给命运的轮盘吧。

一个轻量的多人决策 + 统计小网站：邮箱注册验证、每日转一次随机轮盘、忘了转就发邮件提醒、全员战况热力图 + 撸率排行榜、可自定义头像昵称。

技术栈：**Node.js + Express + SQLite + 原生前端 + Chart.js**，邮件走 **Gmail SMTP**。零外部数据库、零构建步骤，一台小 VPS 就能跑。

---

## ✨ 功能

- 📧 **邮箱注册验证**：注册后收验证邮件，验证通过才能登录（bcrypt 加密存储密码）
- 🎰 **命运轮盘**：每天转一次，50/50 随机出「撸 / 不撸」，当天结果锁定，附转盘动画
- ⏰ **每日提醒**：定时给当天还没做决定的人发邮件催一催（时间可配）
- 📊 **战况统计**：每人每天的热力网格 + Chart.js 撸率排行柱状图，支持近 7/14/30 天切换
- 🧑‍🎨 **个人资料**：上传头像、改昵称，实时显示在统计图上

---

## 🚀 一键部署（推荐，Ubuntu / Debian VPS）

```bash
# 1. 拉代码
git clone https://github.com/DykiSensei/do-or-not.git
cd do-or-not

# 2. 一键部署（按提示输入域名、Gmail 配置即可）
sudo bash deploy.sh
```

脚本会自动完成：安装 Node.js 20 + pm2 → 安装依赖 → 生成 `.env`（含随机 `JWT_SECRET`）→ pm2 守护进程开机自启 →（可选）配置 Nginx 反代 + Let's Encrypt HTTPS。

也可以非交互一把梭：

```bash
sudo DOMAIN=lu.example.com \
     SMTP_USER=you@gmail.com \
     SMTP_PASS=your16charapppass \
     EMAIL=you@gmail.com \
     SETUP_NGINX=y \
     bash deploy.sh
```

> 跑脚本前请先把域名的 A 记录解析到服务器 IP，否则 HTTPS 证书签发会失败（可稍后手动 `certbot --nginx -d 你的域名` 补签）。

---

## 🧪 本地开发

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# 编辑 .env，至少填好 JWT_SECRET（随便一段长字符串即可）
npm start                   # 或 npm run dev（文件改动自动重启）
```

打开 http://localhost:3000

**本地不想配 Gmail 也能调试**：注册接口会因发信失败而报错，可手动把数据库里的用户标记为已验证后直接登录：

```bash
node -e "const db=require('./db/database');db.prepare('UPDATE users SET verified=1 WHERE email=?').run('你的邮箱');console.log('done')"
```

---

## 🔑 配置 Gmail 发信（应用专用密码）

普通 Gmail 登录密码不能用于 SMTP，需要生成「应用专用密码」：

1. 登录 [Google 账号](https://myaccount.google.com/security) → **安全性**
2. 开启 **两步验证**（必须先开）
3. 搜索/进入 **应用专用密码**，生成一个 16 位密码
4. 填入 `.env`：`SMTP_USER` = 你的 Gmail 地址，`SMTP_PASS` = 这个 16 位密码

> 用其他邮箱服务商也行，把 `services/mailer.js` 里的 `service: 'gmail'` 换成对应的 `host` / `port` / `secure` 即可。

---

## ⚙️ 配置项（`.env`）

| 变量 | 说明 | 示例 / 默认 |
|------|------|------|
| `PORT` | 应用监听端口 | `3000` |
| `APP_URL` | 公网访问地址，用于拼接邮箱验证链接和 cookie secure 判定 | `https://lu.example.com` |
| `JWT_SECRET` | 登录令牌签名密钥，**生产务必改成随机长串** | `openssl rand -hex 32` |
| `SMTP_USER` | 发信 Gmail 地址 | `you@gmail.com` |
| `SMTP_PASS` | Gmail 应用专用密码（16 位） | — |
| `MAIL_FROM_NAME` | 发件人显示名 | `撸还是不撸` |
| `REMINDER_CRON` | 每日提醒时间（cron 表达式，服务器本地时区） | `0 21 * * *`（每天 21:00） |

---

## 🛠️ 手动部署（不想用脚本）

```bash
# 安装 Node.js 18+ 和编译工具
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs build-essential python3

# 安装依赖、配置
npm install --omit=dev
cp .env.example .env && nano .env     # 填好 JWT_SECRET / SMTP_* / APP_URL

# pm2 守护
sudo npm i -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

然后用 Nginx 反代到 `127.0.0.1:3000` 并用 certbot 配 HTTPS（配好后把 `.env` 的 `APP_URL` 改成 `https://...`，cookie 才会带 `secure`）。`deploy.sh` 里有现成的 Nginx 配置可参考。

### 常用运维命令
```bash
pm2 logs do-or-not       # 看日志
pm2 restart do-or-not    # 改了 .env 后重启
pm2 status               # 进程状态
```

---

## 💾 数据与备份

- 数据库：`data/app.db`（SQLite，含 WAL 文件）
- 上传的头像：`public/uploads/`

备份带上这两处即可。两者都已在 `.gitignore` 中，不会被提交。

---

## 🔒 安全说明

本项目在设计上已做的防护：

- 全程**参数化 SQL**（better-sqlite3 prepared statements），无拼接，杜绝注入
- 密码 **bcrypt** 加盐哈希；登录令牌 **JWT** 存于 **httpOnly + SameSite=Lax** cookie（HTTPS 下自动加 `secure`），可抵御 XSS 窃取与大部分 CSRF
- 邮箱验证 token 为 **256 位随机数**，比较用 **timingSafeEqual** 防时序侧信道，24 小时过期
- 注册/登录接口**限流**（15 分钟 20 次）
- **helmet** 安全响应头 + 严格 **CSP**（脚本仅允许同源与 Chart.js CDN）、`X-Content-Type-Options: nosniff`、点击劫持防护
- 头像上传**白名单 MIME + 强制扩展名 + 随机文件名 + 2MB 限制**，不接受 SVG（避免存储型 XSS）

部署时请确保：`JWT_SECRET` 已改为随机值、启用 HTTPS、`.env` 权限 `600`（脚本已自动设置）。

> 注意：这是面向小圈子朋友的趣味项目，注册接口会提示「该邮箱已注册」，存在轻微的账号枚举（可据此判断某邮箱是否注册过）。如需对外公开部署，可自行调整为统一提示。

---

## 📁 目录结构

```
do-or-not/
├── server.js              # Express 入口（helmet / 路由 / 静态资源 / 错误处理）
├── ecosystem.config.js    # PM2 进程配置
├── deploy.sh              # 一键部署脚本
├── db/database.js         # SQLite 建表
├── routes/
│   ├── auth.js            # 注册 / 验证 / 登录 / 登出
│   ├── decision.js        # 转轮盘 / 查今日
│   ├── stats.js           # 统计总览
│   └── user.js            # 资料：头像 / 昵称
├── middleware/auth.js     # JWT 签发与校验
├── services/mailer.js     # Gmail SMTP 发信
├── cron/reminder.js       # 每日未决定提醒
├── utils/day.js           # 本地日期工具
└── public/                # 前端：登录 / 注册 / 主页 + CSS/JS
```

---

## 📜 License

[MIT](./LICENSE) © DykiSensei
