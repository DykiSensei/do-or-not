const cron = require('node-cron');
const db = require('../db/database');
const { today } = require('../utils/day');
const { sendReminderEmail } = require('../services/mailer');

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
    console.log(`[reminder] ${day} 无人需要提醒（已全员决定或无已验证用户）`);
    return;
  }

  const link = process.env.APP_URL || 'http://localhost:3000';
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await sendReminderEmail(u.email, u.nickname, link);
      sent += 1;
    } catch (e) {
      failed += 1;
      console.error(`[reminder] 发给 ${u.email} 失败：`, e.message);
    }
  }
  console.log(`[reminder] ${day} 完成：成功 ${sent} / 失败 ${failed} / 总 ${users.length}`);
}

const DEFAULT_CRON = '0 21 * * *';

function schedule() {
  const raw = process.env.REMINDER_CRON || DEFAULT_CRON;
  const valid = cron.validate(raw);
  if (!valid) {
    console.error(`[reminder] REMINDER_CRON 表达式无效：${raw}，已回退到默认 ${DEFAULT_CRON}`);
  }
  const expr = valid ? raw : DEFAULT_CRON;
  // REMINDER_TZ 可显式指定时区（如 'Asia/Shanghai'），避免服务器是 UTC 时悄悄漂时间
  const timezone = process.env.REMINDER_TZ || undefined;

  const task = cron.schedule(expr, () => {
    runReminder().catch((e) => console.error('[reminder] 执行出错：', e));
  }, timezone ? { timezone } : undefined);

  const next = task.getNextRun();
  const tzNote = timezone ? ` TZ=${timezone}` : ` (服务器本地时区，建议设 REMINDER_TZ)`;
  console.log(`[reminder] 已排程 cron='${expr}'${tzNote}，下次触发：${next ? next.toISOString() : '未知'}`);
}

module.exports = { schedule, runReminder };
