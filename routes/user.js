const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '';
    cb(null, `${req.user.id}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('只支持 png/jpg/webp/gif 图片'), ok);
  },
});

// 当前用户信息
router.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, email, nickname, avatar FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json(u);
});

// 改昵称
router.put('/nickname', requireAuth, (req, res) => {
  const nickname = (req.body?.nickname || '').trim();
  if (!nickname || nickname.length > 20) return res.status(400).json({ error: '昵称必填且不超过 20 字' });
  db.prepare('UPDATE users SET nickname=? WHERE id=?').run(nickname, req.user.id);
  res.json({ ok: true, nickname });
});

// 传头像
router.post('/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '未收到图片' });

    // 删掉旧头像文件
    const old = db.prepare('SELECT avatar FROM users WHERE id=?').get(req.user.id)?.avatar;
    if (old && old.startsWith('/uploads/')) {
      const oldPath = path.join(uploadDir, path.basename(old));
      fs.existsSync(oldPath) && fs.unlink(oldPath, () => {});
    }

    const url = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
    res.json({ ok: true, avatar: url });
  });
});

module.exports = router;
