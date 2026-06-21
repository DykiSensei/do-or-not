const cron = require('node-cron');
const db = require('../db/database');
const { today, DEFAULT_TZ } = require('../utils/day');
const { sendReminderEmail } = require('../services/mailer');

// 每个用户在他自己时区的 REMINDER_HOUR 点收提醒。
// 实现：每小时整点扫一次所有已验证用户；本地时间 = REMINDER_HOUR 且今天还没决定 → 发
async function runReminder() {
  const hour = parseInt(process.env.REMINDER_HOUR || '21', 10);
  const link = process.env.APP_URL || 'http://localhost:3000';

  const users = db.prepare('SELECT id, email, nickname, timezone FROM users WHERE verified=1').all();
  if (users.length === 0) return;

  const fmtHour = (tz) => parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()), 10);

  let due = 0, sent = 0, failed = 0;
  for (const u of users) {
    const tz = u.timezone || DEFAULT_TZ;
    let nowHour;
    try { nowHour = fmtHour(tz); } catch { nowHour = fmtHour(DEFAULT_TZ); }
    if (nowHour !== hour) continue;
    due += 1;

    const day = today(tz);
    const decided = db.prepare('SELECT 1 FROM decisions WHERE user_id=? AND day=?').get(u.id, day);
    if (decided) continue;

    try {
      await sendReminderEmail(u.email, u.nickname, link);
      sent += 1;
    } catch (e) {
      failed += 1;
      console.error(`[reminder] 发给 ${u.email} (${tz}) 失败：`, e.message);
    }
  }
  if (due > 0) {
    console.log(`[reminder] 本小时到点 ${due} 人，已发 ${sent} / 失败 ${failed}（剩余为今日已决定）`);
  }
}

function schedule() {
  const hour = parseInt(process.env.REMINDER_HOUR || '21', 10);
  // 每小时整点扫一次。cron 时区无所谓，反正每小时都会触发；判断在 runReminder 里按各用户算
  const task = cron.schedule('0 * * * *', () => {
    runReminder().catch((e) => console.error('[reminder] 执行出错：', e));
  });
  const next = task.getNextRun();
  console.log(`[reminder] 已排程：每小时整点扫一次，用户本地 ${hour}:00 触发；下次扫描：${next ? next.toISOString() : '未知'}`);
}

module.exports = { schedule, runReminder };
