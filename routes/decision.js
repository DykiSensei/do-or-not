const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { today } = require('../utils/day');

const router = express.Router();

// 今天是否已决定
router.get('/today', requireAuth, (req, res) => {
  const day = today();
  const row = db.prepare('SELECT result, created_at FROM decisions WHERE user_id=? AND day=?')
    .get(req.user.id, day);
  res.json({ day, decided: !!row, result: row ? row.result : null });
});

// 转轮盘：随机产生今天的结果，一天只能一次
router.post('/spin', requireAuth, (req, res) => {
  const day = today();
  const existing = db.prepare('SELECT result FROM decisions WHERE user_id=? AND day=?')
    .get(req.user.id, day);
  if (existing) {
    return res.status(409).json({ error: '今天已经转过啦', result: existing.result });
  }

  // 命运的轮盘：50/50
  const result = Math.random() < 0.5 ? 'lu' : 'bulu';
  db.prepare('INSERT INTO decisions (user_id, day, result, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, day, result, Date.now());

  res.json({ ok: true, day, result });
});

module.exports = router;
