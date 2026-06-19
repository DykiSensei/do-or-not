const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_LEN = 500;

// 列出某条打卡(决定)下的评论，按时间正序
router.get('/:decisionId', requireAuth, (req, res) => {
  const decisionId = parseInt(req.params.decisionId, 10);
  if (!decisionId) return res.status(400).json({ error: '参数错误' });

  const rows = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.user_id,
           u.nickname, u.avatar
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.decision_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `).all(decisionId);

  res.json({ comments: rows });
});

// 在某条打卡下发表评论
router.post('/:decisionId', requireAuth, (req, res) => {
  const decisionId = parseInt(req.params.decisionId, 10);
  if (!decisionId) return res.status(400).json({ error: '参数错误' });

  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: '评论不能为空' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: `评论不超过 ${MAX_LEN} 字` });

  const decision = db.prepare('SELECT id FROM decisions WHERE id=?').get(decisionId);
  if (!decision) return res.status(404).json({ error: '该打卡不存在' });

  const info = db.prepare('INSERT INTO comments (decision_id, user_id, body, created_at) VALUES (?,?,?,?)')
    .run(decisionId, req.user.id, body, Date.now());

  const row = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.user_id, u.nickname, u.avatar
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `).get(info.lastInsertRowid);

  res.json({ ok: true, comment: row });
});

// 删除自己的评论
router.delete('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: '参数错误' });

  const c = db.prepare('SELECT user_id FROM comments WHERE id=?').get(id);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的评论' });

  db.prepare('DELETE FROM comments WHERE id=?').run(id);
  res.json({ ok: true });
});

module.exports = router;
