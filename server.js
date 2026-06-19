require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const { verifyConnection } = require('./services/mailer');
const reminder = require('./cron/reminder');

// 关键配置缺失则快速失败，避免运行到一半才崩
if (!process.env.JWT_SECRET) {
  console.error('启动失败：缺少 JWT_SECRET，请在 .env 中配置（参考 .env.example）');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // 部署在 Nginx 等反代后面时，正确识别 https / IP

// 安全响应头：CSP / nosniff / 防点击劫持 等
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // app.js / login.js 等走 self；Chart.js 走 jsdelivr CDN
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      // 页面里有 style="" 内联样式，需放行内联样式（仅样式，风险低）
      styleSrc: ["'self'", "'unsafe-inline'"],
      // 默认头像是 data: SVG
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/decision', require('./routes/decision'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/user', require('./routes/user'));

// 静态资源（前端 + 上传的头像）
app.use(express.static(path.join(__dirname, 'public')));

// 根路径：未登录引导到 login，已登录看主页（由前端 js 判断后跳转）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 兜底错误处理：单个请求出错只返回 500，不拖垮整个进程
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误' });
});
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`撸还是不撸 运行中 → http://localhost:${PORT}`);
  verifyConnection();
  reminder.schedule();
});
