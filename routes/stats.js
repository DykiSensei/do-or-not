const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { lastNDays } = require('../utils/day');

const router = express.Router();

// 统计：最近 N 天每个用户每天的撸/不撸情况
// 返回 { days: [...], users: [{ id, nickname, avatar, results: { 'YYYY-MM-DD': 'lu'|'bulu' }, luCount, total }] }
router.get('/overview', requireAuth, (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
  const days = lastNDays(n);
  const since = days[0];

  const users = db.prepare('SELECT id, nickname, avatar FROM users WHERE verified=1 ORDER BY id').all();
  const rows = db.prepare('SELECT user_id, day, result FROM decisions WHERE day >= ?').all(since);

  const byUser = new Map();
  for (const u of users) {
    byUser.set(u.id, { id: u.id, nickname: u.nickname, avatar: u.avatar, results: {}, luCount: 0, total: 0 });
  }
  for (const r of rows) {
    const u = byUser.get(r.user_id);
    if (!u) continue;
    u.results[r.day] = r.result;
    u.total += 1;
    if (r.result === 'lu') u.luCount += 1;
  }

  res.json({ days, users: Array.from(byUser.values()) });
});

module.exports = router;
