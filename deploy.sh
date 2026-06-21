#!/usr/bin/env bash
#
# 撸还是不撸 —— 一键部署脚本（Ubuntu / Debian）
#
# 用法：
#   sudo bash deploy.sh
# 或带参数非交互运行：
#   sudo DOMAIN=lu.example.com SMTP_USER=me@gmail.com SMTP_PASS=xxxx EMAIL=me@gmail.com bash deploy.sh
#
# 脚本会：安装 Node.js + pm2 → 装依赖 → 生成 .env(含随机 JWT_SECRET) →
#         用 pm2 守护进程 → (可选) 配置 Nginx 反代 + Let's Encrypt HTTPS
#
set -euo pipefail

# ---------- 小工具 ----------
c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { c_red "✗ $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy.sh"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
c_green "==> 项目目录：$APP_DIR"

# ---------- 收集配置 ----------
prompt() { # prompt VAR "提示" "默认值"
  local var="$1" msg="$2" def="${3:-}"
  local cur="${!var:-}"
  if [ -n "$cur" ]; then return; fi          # 已由环境变量提供
  if [ -n "$def" ]; then
    read -rp "$msg [$def]: " val || true
    printf -v "$var" '%s' "${val:-$def}"
  else
    read -rp "$msg: " val || true
    printf -v "$var" '%s' "$val"
  fi
}

c_yellow "==> 配置（直接回车用默认值；邮件相关可留空，之后再填 .env）"
prompt DOMAIN    "你的域名（用于 HTTPS 与验证邮件链接，留空则用 http://服务器IP:PORT）" ""
prompt PORT      "应用监听端口" "3000"
prompt SMTP_USER "Gmail 地址（发验证/提醒邮件用）" ""
prompt SMTP_PASS "Gmail 应用专用密码（16位，非登录密码）" ""
prompt EMAIL     "申请 HTTPS 证书用的邮箱" "${SMTP_USER:-}"
SETUP_NGINX="${SETUP_NGINX:-}"
if [ -z "$SETUP_NGINX" ]; then
  if [ -n "$DOMAIN" ]; then read -rp "是否自动配置 Nginx 反代 + HTTPS？(y/N): " SETUP_NGINX || true; fi
fi

if [ -n "$DOMAIN" ]; then APP_URL="https://$DOMAIN"; else APP_URL="http://localhost:$PORT"; fi

# ---------- 安装 Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  c_green "==> 安装 Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  c_green "==> 已安装 Node.js：$(node -v)"
fi

# 编译 better-sqlite3 需要的工具链
c_green "==> 安装编译依赖（build-essential / python3）"
apt-get update -y
apt-get install -y build-essential python3 ca-certificates curl

# ---------- 安装项目依赖 ----------
c_green "==> 安装 npm 依赖（生产）"
npm install --omit=dev

# ---------- 生成 .env ----------
if [ -f .env ]; then
  c_yellow "==> 已存在 .env，跳过生成（如需重置请先删除）"
else
  c_green "==> 生成 .env（JWT_SECRET 自动随机）"
  JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  cat > .env <<EOF
PORT=$PORT
APP_URL=$APP_URL
JWT_SECRET=$JWT_SECRET
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
MAIL_FROM_NAME=撸还是不撸
REMINDER_CRON=0 21 * * *
REMINDER_TZ=Asia/Shanghai
EOF
  chmod 600 .env
fi

# ---------- pm2 守护 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  c_green "==> 安装 pm2"
  npm install -g pm2
fi
c_green "==> 用 pm2 启动应用"
pm2 startOrReload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u "${SUDO_USER:-root}" --hp "$(eval echo ~${SUDO_USER:-root})" >/dev/null 2>&1 || true

# ---------- 可选：Nginx + HTTPS ----------
if [[ "${SETUP_NGINX,,}" == "y" || "${SETUP_NGINX,,}" == "yes" ]] && [ -n "$DOMAIN" ]; then
  c_green "==> 配置 Nginx 反向代理：$DOMAIN -> 127.0.0.1:$PORT"
  apt-get install -y nginx
  cat > "/etc/nginx/sites-available/do-or-not.conf" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/do-or-not.conf /etc/nginx/sites-enabled/do-or-not.conf
  nginx -t && systemctl reload nginx

  c_green "==> 申请 Let's Encrypt 证书（certbot）"
  apt-get install -y certbot python3-certbot-nginx
  if [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
      c_yellow "certbot 失败，请确认域名已解析到本机后手动执行：certbot --nginx -d $DOMAIN"
  else
    c_yellow "未提供邮箱，跳过自动签发。手动执行：certbot --nginx -d $DOMAIN"
  fi
fi

# ---------- 完成 ----------
c_green "================ 部署完成 ================"
echo "应用地址：$APP_URL"
echo "查看日志：pm2 logs do-or-not"
echo "重启应用：pm2 restart do-or-not"
echo "配置文件：$APP_DIR/.env"
if [ -z "$SMTP_USER" ] || [ -z "$SMTP_PASS" ]; then
  c_yellow "提醒：你还没填 Gmail 发信配置，邮箱验证/提醒功能暂不可用。"
  c_yellow "      编辑 $APP_DIR/.env 填好 SMTP_USER / SMTP_PASS 后执行 pm2 restart do-or-not"
fi
