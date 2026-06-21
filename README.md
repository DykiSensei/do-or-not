# 撸还是不撸

> 每天来一次的命运轮盘：今天撸还是不撸？

一个面向小圈子朋友的多人决策 + 打卡 + 战况统计小站。Node.js + Express + SQLite + 原生前端 + Chart.js，邮件走 Gmail SMTP，无外部数据库、无构建步骤。

## 功能

- 邮箱注册（验证邮件 + bcrypt 密码哈希）
- 每天一次的随机轮盘，或自己手动选「撸 / 不撸」，定了就锁
- 图文打卡（文字 ≤ 1000 字、配图 ≤ 4MB，可重发替换）
- 动态信息流 + 评论；战况热力图 + 撸率排行（近 7/14/30 天）
- 当天 21:00 给还没决定的人发邮件催一催
- 头像 / 昵称自定义

## 本地开发

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
# 编辑 .env，至少填好 JWT_SECRET
npm run dev              # 热重载
```

打开 <http://localhost:3000>。

不想配 Gmail 也能调：把数据库里的用户直接标为已验证再登录。

```bash
node -e "require('./db/database').prepare('UPDATE users SET verified=1 WHERE email=?').run('你的邮箱')"
```

## 一键部署（Ubuntu / Debian）

```bash
git clone https://github.com/DykiSensei/do-or-not.git
cd do-or-not
sudo bash deploy.sh
```

脚本会装 Node 20 + pm2、装依赖、生成带随机 `JWT_SECRET` 的 `.env`、用 pm2 拉起、可选配置 Nginx 反代 + Let's Encrypt HTTPS。

非交互版：

```bash
sudo DOMAIN=lu.example.com \
     SMTP_USER=you@gmail.com SMTP_PASS=your16charapppass \
     EMAIL=you@gmail.com SETUP_NGINX=y \
     bash deploy.sh
```

跑之前先把域名 A 记录解析到服务器，不然证书签发会失败。

## 升级

```bash
bash update.sh
```

用当初部署的那个用户跑，**别加 sudo、别用 root**（pm2 进程归属那个用户）。脚本只做三件事：`git pull` → 仅当 `package.json` 变了才 `npm install --omit=dev` → `pm2 restart do-or-not`。不会动 `.env`、`data/`、`public/uploads/`、Nginx 配置和证书。

## 配置（`.env`）

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 `3000` |
| `APP_URL` | 公网地址，用于拼邮件验证链接和判定 cookie secure。HTTPS 上线后必须改成 `https://...` |
| `JWT_SECRET` | 登录令牌签名密钥，生产环境务必随机生成（`openssl rand -hex 32`） |
| `SMTP_USER` / `SMTP_PASS` | Gmail 地址 + 应用专用密码（16 位，不是登录密码） |
| `MAIL_FROM_NAME` | 发件人显示名 |
| `REMINDER_CRON` | 每日提醒的 cron 表达式，默认 `0 21 * * *` |
| `REMINDER_TZ` | 提醒时区（IANA 名），默认 `Asia/Shanghai`。非中国用户改成自己的时区 |

Gmail 应用专用密码：[Google 账号](https://myaccount.google.com/security) → 安全性 → 开两步验证 → 应用专用密码。用其他邮箱服务商把 `services/mailer.js` 里的 `service: 'gmail'` 换成对应 `host` / `port` / `secure` 即可。

## 运维

```bash
pm2 logs do-or-not       # 日志
pm2 restart do-or-not    # 改了 .env 后重启
pm2 status
```

数据备份带走两处即可：

- `data/app.db`（SQLite，含 WAL 文件）
- `public/uploads/`（头像 + 打卡照）

两者都在 `.gitignore` 里，不会被 `git pull` 覆盖。

## 安全说明

- 全程参数化 SQL（better-sqlite3 prepared）、密码 bcrypt、JWT 存于 httpOnly + SameSite=Lax cookie（HTTPS 下加 `secure`）
- 邮箱验证 token 是 256 位随机数，比较用 `timingSafeEqual`，24h 过期
- 注册 / 登录 15 分钟限流 20 次；helmet 严格 CSP；上传白名单 MIME + 强制扩展名 + 随机文件名 + 大小限制（不接受 SVG）
- 打卡文字 ≤ 1000 字、评论 ≤ 500 字，文字与图片地址渲染时走 `escapeHtml` 转义

部署前请确认：`JWT_SECRET` 已改成随机串、启用 HTTPS、`.env` 权限 `600`（脚本已自动设置）。

> 注册接口会区分「已注册」和「未注册」，存在轻微账号枚举——面向小圈子的取舍，对外公开部署请自行改成统一提示。

## 目录结构

```
server.js              Express 入口
ecosystem.config.js    PM2 进程配置
deploy.sh / update.sh  一键部署 / 更新脚本
db/database.js         SQLite 建表 + 内联迁移
routes/                auth / decision / feed / stats / comments / user
middleware/auth.js     JWT 签发 + requireAuth
services/mailer.js     Gmail SMTP
cron/reminder.js       每日未决定提醒
utils/day.js           本地日期工具
public/                前端
```

## License

[MIT](./LICENSE) © DykiSensei
