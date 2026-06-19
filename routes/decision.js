const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { today } = require('../utils/day');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 打卡照片上传：与头像同样的白名单 + 随机文件名 + 强制扩展名策略
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, `checkin_${req.user.id}_${crypto.randomBytes(8).toString('hex')}${EXT[file.mimetype] || ''}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
  fileFilter: (req, file, cb) => {
    const ok = Object.prototype.hasOwnProperty.call(EXT, file.mimetype);
    cb(ok ? null : new Error('只支持 png/jpg/webp/gif 图片'), ok);
  },
});

// 今天是否已决定
router.get('/today', requireAuth, (req, res) => {
  const day = today();
  const row = db.prepare('SELECT result, mode, photo, created_at FROM decisions WHERE user_id=? AND day=?')
    .get(req.user.id, day);
  res.json({
    day,
    decided: !!row,
    result: row ? row.result : null,
    mode: row ? row.mode : null,
    photo: row ? row.photo : null,
  });
});

// 写入今天的决定（轮盘随机 or 手动选择共用），一天只能一次
function decide(req, res, result, mode) {
  const day = today();
  const existing = db.prepare('SELECT result FROM decisions WHERE user_id=? AND day=?').get(req.user.id, day);
  if (existing) {
    return res.status(409).json({ error: '今天已经决定过啦', result: existing.result });
  }
  db.prepare('INSERT INTO decisions (user_id, day, result, mode, created_at) VALUES (?,?,?,?,?)')
    .run(req.user.id, day, result, mode, Date.now());
  res.json({ ok: true, day, result, mode });
}

// 转轮盘：随机产生今天的结果
router.post('/spin', requireAuth, (req, res) => {
  decide(req, res, Math.random() < 0.5 ? 'lu' : 'bulu', 'spin');
});

// 手动选择今天的结果
router.post('/choose', requireAuth, (req, res) => {
  const result = req.body?.result;
  if (result !== 'lu' && result !== 'bulu') {
    return res.status(400).json({ error: '参数错误：result 只能是 lu 或 bulu' });
  }
  decide(req, res, result, 'manual');
});

// 打卡：给今天的决定上传/替换一张照片（需先决定）
router.post('/photo', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '未收到图片' });

    const cleanup = () => fs.existsSync(req.file.path) && fs.unlink(req.file.path, () => {});

    const day = today();
    const row = db.prepare('SELECT id, photo FROM decisions WHERE user_id=? AND day=?').get(req.user.id, day);
    if (!row) {
      cleanup(); // 还没决定就别留下孤儿文件
      return res.status(409).json({ error: '请先决定今天撸还是不撸，再来打卡' });
    }

    // 删掉旧打卡照片
    if (row.photo && row.photo.startsWith('/uploads/')) {
      const oldPath = path.join(uploadDir, path.basename(row.photo));
      fs.existsSync(oldPath) && fs.unlink(oldPath, () => {});
    }

    const url = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE decisions SET photo=? WHERE id=?').run(url, row.id);
    res.json({ ok: true, photo: url });
  });
});

module.exports = router;
