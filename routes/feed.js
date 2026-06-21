const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 信息流：所有人的打卡(决定)，按时间倒序，游标分页（before = 上一页最后一条的 id）
// 每条帖子内联其评论，前端可直接渲染整个动态流
router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const before = parseInt(req.query.before, 10) || 0;

  const posts = (before > 0
    ? db.prepare(`
        SELECT d.id, d.day, d.result, d.mode, d.photo, d.note, d.location, d.created_at,
               u.id AS user_id, u.nickname, u.avatar
        FROM decisions d JOIN users u ON u.id = d.user_id
        WHERE d.id < ?
        ORDER BY d.id DESC LIMIT ?`).all(before, limit)
    : db.prepare(`
        SELECT d.id, d.day, d.result, d.mode, d.photo, d.note, d.location, d.created_at,
               u.id AS user_id, u.nickname, u.avatar
        FROM decisions d JOIN users u ON u.id = d.user_id
        ORDER BY d.id DESC LIMIT ?`).all(limit));

  // 一次性取这页所有帖子的评论，再按帖子分组，避免 N+1
  const byPost = new Map();
  if (posts.length) {
    const ids = posts.map((p) => p.id);
    const ph = ids.map(() => '?').join(',');
    const comments = db.prepare(`
      SELECT c.id, c.decision_id, c.body, c.created_at, c.user_id, c.parent_id,
             u.nickname, u.avatar
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.decision_id IN (${ph})
      ORDER BY c.created_at ASC, c.id ASC
    `).all(...ids);
    for (const c of comments) {
      if (!byPost.has(c.decision_id)) byPost.set(c.decision_id, []);
      byPost.get(c.decision_id).push({
        id: c.id, body: c.body, created_at: c.created_at, parent_id: c.parent_id,
        user_id: c.user_id, nickname: c.nickname, avatar: c.avatar,
      });
    }
  }

  const out = posts.map((p) => ({
    id: p.id,
    day: p.day,
    result: p.result,
    mode: p.mode,
    photo: p.photo,
    note: p.note,
    location: p.location,
    created_at: p.created_at,
    user: { id: p.user_id, nickname: p.nickname, avatar: p.avatar },
    comments: byPost.get(p.id) || [],
  }));

  res.json({ posts: out, hasMore: posts.length === limit });
});

module.exports = router;
