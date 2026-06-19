#!/usr/bin/env bash
#
# 撸还是不撸 —— 一键更新脚本
#
# 用途：把 VPS 上已部署的实例更新到 GitHub 最新版本。
#   只做：拉取最新代码 → (有变化时)装新依赖 → pm2 重启。
#   绝不碰：.env / 数据库(data/) / 头像(public/uploads/) / Nginx / 证书。
#
# 用法（用当初部署时的同一个用户运行，不要 sudo / 不要用 root）：
#   bash update.sh
#
set -euo pipefail

c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { c_red "✗ $*"; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
APP_NAME="do-or-not"

[ -d .git ] || die "这里不是 git 仓库（$APP_DIR），无法更新。请确认是用 git clone 部署的。"

# 本地若有未提交改动，先提示，避免 git pull 失败
if ! git diff --quiet || ! git diff --cached --quiet; then
  c_yellow "检测到本地有未提交的改动，更新可能失败。"
  c_yellow "（.env / data/ / uploads/ 已被忽略，不算在内，可放心）"
  c_yellow "如确需保留本地改动，可先 git stash，更新后再 git stash pop。"
fi

BEFORE="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

c_green "==> 拉取最新代码（$BRANCH）"
git fetch --prune origin
if ! git merge --ff-only "origin/$BRANCH"; then
  die "无法快进合并（本地可能有冲突改动）。请手动处理：git status / git stash 后重试。"
fi

AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  c_green "==> 已是最新版本，无需更新。"
  exit 0
fi
c_green "==> 代码已更新：${BEFORE:0:7} -> ${AFTER:0:7}"

# 依赖有变化才重装（package.json / lock 改了）
if ! git diff --quiet "$BEFORE" "$AFTER" -- package.json package-lock.json; then
  c_green "==> 依赖有更新，安装中（仅生产依赖）"
  npm install --omit=dev
else
  c_green "==> 依赖无变化，跳过 npm install"
fi

# 重启进程（pm2 已托管则重启；否则尝试启动）
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    c_green "==> 重启应用（pm2 restart $APP_NAME）"
    pm2 restart "$APP_NAME" --update-env
  else
    c_green "==> 应用未在 pm2 中，启动它"
    pm2 start ecosystem.config.js
  fi
  pm2 save >/dev/null 2>&1 || true
else
  die "未找到 pm2。若用其它方式守护进程，请手动重启服务。"
fi

c_green "================ 更新完成 ================"
echo "当前版本：$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
echo "查看日志：pm2 logs $APP_NAME"
