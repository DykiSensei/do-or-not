const cron = require('node-cron');
const db = require('../db/database');
const { today } = require('../utils/day');
const { sendReminderEmail } = require('../services/mailer');

// 找出今天还没做决定的已验证用户，逐个发提醒邮件
async function runReminder() {
  const day = today();
  const users = db.prepare(`
    SELECT u.email, u.nickname
    FROM users u
    WHERE u.verified = 1
      AND NOT EXISTS (
        SELECT 1 FROM decisions d WHERE d.user_id = u.id AND d.day = ?
      )
  `).all(day);

  if (users.length === 0) {
    console.log(`[reminder] ${day} 所有人都已决定，无需提醒`);
    return;
  }

  const link = process.env.APP_URL || 'http://localhost:3000';
  let sent = 0;
  for (const u of users) {
    try {
      await sendReminderEmail(u.email, u.nickname, link);
      sent += 1;
    } catch (e) {
      console.error(`[reminder] 发给 ${u.email} 失败：`, e.message);
    }
  }
  console.log(`[reminder] ${day} 共提醒 ${sent}/${users.length} 人`);
}

function schedule() {
  const expr = process.env.REMINDER_CRON || '0 21 * * *';
  if (!cron.validate(expr)) {
    console.error(`[reminder] REMINDER_CRON 表达式无效：${expr}，使用默认 0 21 * * *`);
  }
  cron.schedule(cron.validate(expr) ? expr : '0 21 * * *', () => {
    runReminder().catch((e) => console.error('[reminder] 执行出错：', e));
  });
  console.log(`[reminder] 已排程，cron = ${expr}`);
}

module.exports = { schedule, runReminder };
