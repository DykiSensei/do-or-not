const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { today, DEFAULT_TZ } = require('../utils/day');
const { lookupIp } = require('../services/geo');

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

// 今天是否已决定。「今天」按该用户保存的时区算
router.get('/today', requireAuth, (req, res) => {
  const u = db.prepare('SELECT timezone FROM users WHERE id=?').get(req.user.id);
  const day = today(u?.timezone || DEFAULT_TZ);
  const row = db.prepare('SELECT result, mode, photo, note, created_at FROM decisions WHERE user_id=? AND day=?')
    .get(req.user.id, day);
  res.json({
    day,
    decided: !!row,
    result: row ? row.result : null,
    mode: row ? row.mode : null,
    photo: row ? row.photo : null,
    note: row ? row.note : null,
  });
});

// 写入今天的决定（轮盘随机 or 手动选择共用），一天只能一次。
// 顺手查 IP 拿时区+地区：记到该条决定，同时把用户当前时区刷新到 users 表（提醒用）
async function decide(req, res, result, mode) {
  const geo = await lookupIp(req.ip);
  const tz = geo.timezone || db.prepare('SELECT timezone FROM users WHERE id=?').get(req.user.id)?.timezone || DEFAULT_TZ;
  const day = today(tz);

  const existing = db.prepare('SELECT result FROM decisions WHERE user_id=? AND day=?').get(req.user.id, day);
  if (existing) {
    return res.status(409).json({ error: '今天已经决定过啦', result: existing.result });
  }
  db.prepare('INSERT INTO decisions (user_id, day, result, mode, location, timezone, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, day, result, mode, geo.label, tz, Date.now());
  if (geo.timezone) {
    db.prepare('UPDATE users SET timezone=? WHERE id=?').run(geo.timezone, req.user.id);
  }
  res.json({ ok: true, day, result, mode, location: geo.label });
}

// 转轮盘：随机产生今天的结果
router.post('/spin', requireAuth, (req, res, next) => {
  decide(req, res, Math.random() < 0.5 ? 'lu' : 'bulu', 'spin').catch(next);
});

// 手动选择今天的结果
router.post('/choose', requireAuth, (req, res, next) => {
  const result = req.body?.result;
  if (result !== 'lu' && result !== 'bulu') {
    return res.status(400).json({ error: '参数错误：result 只能是 lu 或 bulu' });
  }
  decide(req, res, result, 'manual').catch(next);
});

// 打卡：给今天的决定写文字 / 传照片（二者皆可选，可纯文字、可纯图、可都有；需先决定）
router.post('/checkin', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const cleanup = () => req.file && fs.existsSync(req.file.path) && fs.unlink(req.file.path, () => {});

    const u = db.prepare('SELECT timezone FROM users WHERE id=?').get(req.user.id);
    const day = today(u?.timezone || DEFAULT_TZ);
    const row = db.prepare('SELECT id, photo FROM decisions WHERE user_id=? AND day=?').get(req.user.id, day);
    if (!row) {
      cleanup(); // 还没决定就别留下孤儿文件
      return res.status(409).json({ error: '请先决定今天撸还是不撸，再来打卡' });
    }

    const note = (req.body?.note || '').trim();
    if (note.length > 1000) {
      cleanup();
      return res.status(400).json({ error: '打卡文字不超过 1000 字' });
    }

    let photoUrl = row.photo;
    if (req.file) {
      // 传了新图：删掉旧打卡照片
      if (row.photo && row.photo.startsWith('/uploads/')) {
        const oldPath = path.join(uploadDir, path.basename(row.photo));
        fs.existsSync(oldPath) && fs.unlink(oldPath, () => {});
      }
      photoUrl = `/uploads/${req.file.filename}`;
    }

    db.prepare('UPDATE decisions SET note=?, photo=? WHERE id=?').run(note || null, photoUrl, row.id);
    res.json({ ok: true, note: note || null, photo: photoUrl });
  });
});

module.exports = router;
