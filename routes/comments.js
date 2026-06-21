const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_LEN = 500;

// 列出某条打卡(决定)下的评论，按时间正序。带 parent_id 便于前端按线程渲染
router.get('/:decisionId', requireAuth, (req, res) => {
  const decisionId = parseInt(req.params.decisionId, 10);
  if (!decisionId) return res.status(400).json({ error: '参数错误' });

  const rows = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.user_id, c.parent_id,
           u.nickname, u.avatar
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.decision_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `).all(decisionId);

  res.json({ comments: rows });
});

// 在某条打卡下发表评论或回复（parent_id 可选，指被回复的评论）
router.post('/:decisionId', requireAuth, (req, res) => {
  const decisionId = parseInt(req.params.decisionId, 10);
  if (!decisionId) return res.status(400).json({ error: '参数错误' });

  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: '评论不能为空' });
  if (body.length > MAX_LEN) return res.status(400).json({ error: `评论不超过 ${MAX_LEN} 字` });

  const decision = db.prepare('SELECT id FROM decisions WHERE id=?').get(decisionId);
  if (!decision) return res.status(404).json({ error: '该打卡不存在' });

  let parentId = null;
  if (req.body?.parent_id != null) {
    parentId = parseInt(req.body.parent_id, 10);
    if (!parentId) return res.status(400).json({ error: 'parent_id 非法' });
    const parent = db.prepare('SELECT decision_id FROM comments WHERE id=?').get(parentId);
    if (!parent || parent.decision_id !== decisionId) {
      return res.status(400).json({ error: '被回复的评论不在这条打卡下' });
    }
  }

  const info = db.prepare(
    'INSERT INTO comments (decision_id, user_id, body, parent_id, created_at) VALUES (?,?,?,?,?)'
  ).run(decisionId, req.user.id, body, parentId, Date.now());

  const row = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.user_id, c.parent_id, u.nickname, u.avatar
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `).get(info.lastInsertRowid);

  res.json({ ok: true, comment: row });
});

// 删除自己的评论：连带所有后代回复一起删（ALTER 加的列没法挂 FK CASCADE，靠递归 CTE）
router.delete('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: '参数错误' });

  const c = db.prepare('SELECT user_id FROM comments WHERE id=?').get(id);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的评论' });

  const ids = db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM comments WHERE id = ?
      UNION ALL
      SELECT c.id FROM comments c JOIN descendants d ON c.parent_id = d.id
    )
    SELECT id FROM descendants
  `).all(id).map((r) => r.id);

  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM comments WHERE id IN (${ph})`).run(...ids);

  res.json({ ok: true, deleted: ids });
});

module.exports = router;
