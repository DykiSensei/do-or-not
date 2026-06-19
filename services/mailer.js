const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS, // Gmail 应用专用密码
  },
});

const fromName = process.env.MAIL_FROM_NAME || '撸还是不撸';
const from = `"${fromName}" <${process.env.SMTP_USER}>`;

// 启动时检查 SMTP 是否能连上（不阻塞启动，只打印结果）
function verifyConnection() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[mailer] 未配置 SMTP_USER / SMTP_PASS，邮件功能不可用');
    return;
  }
  transporter.verify((err) => {
    if (err) console.error('[mailer] SMTP 连接失败：', err.message);
    else console.log('[mailer] Gmail SMTP 就绪');
  });
}

async function sendVerifyEmail(to, nickname, link) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#6c5ce7;">欢迎，${escapeHtml(nickname)} 👋</h2>
      <p>点击下面的按钮验证你的邮箱，开启每日「撸还是不撸」之旅：</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:#6c5ce7;color:#fff;text-decoration:none;
           padding:12px 28px;border-radius:8px;display:inline-block;">验证邮箱</a>
      </p>
      <p style="color:#888;font-size:13px;">按钮无法点击？复制此链接到浏览器：<br>${link}</p>
      <p style="color:#aaa;font-size:12px;">链接 24 小时内有效。如果不是你本人操作，请忽略此邮件。</p>
    </div>`;
  return transporter.sendMail({ from, to, subject: '验证你的邮箱 · 撸还是不撸', html });
}

async function sendReminderEmail(to, nickname, link) {
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#6c5ce7;">${escapeHtml(nickname)}，今天还没转轮盘哦 🎰</h2>
      <p>命运的轮盘正在等你 —— 今天到底是<strong>撸</strong>还是<strong>不撸</strong>？</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:#6c5ce7;color:#fff;text-decoration:none;
           padding:12px 28px;border-radius:8px;display:inline-block;">立即决定</a>
      </p>
      <p style="color:#aaa;font-size:12px;">不想收到提醒？可在网页设置里关闭（如已实现）或忽略此邮件。</p>
    </div>`;
  return transporter.sendMail({ from, to, subject: '今天还没决定 · 撸还是不撸', html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { transporter, verifyConnection, sendVerifyEmail, sendReminderEmail };
