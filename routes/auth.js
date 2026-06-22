const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../db/database');
const { sign, setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { sendVerifyEmail } = require('../services/mailer');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作过于频繁，请稍后再试' },
});

const VERIFY_TTL = 24 * 60 * 60 * 1000; // 24h

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 定长、防时序侧信道的字符串比较
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Cloudflare Turnstile 服务端校验。未配置 secret 则跳过（本地开发可选）
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') return { ok: false, code: 'missing-token' };

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (ip) params.append('remoteip', ip);

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return { ok: !!data.success, codes: data['error-codes'] || [] };
  } catch (e) {
    return { ok: false, code: 'network', error: e.message };
  }
}

// 前端拉取 site key；未配置时返回 null，前端跳过渲染 widget
router.get('/captcha-config', (req, res) => {
  res.json({ siteKey: process.env.TURNSTILE_SITE_KEY || null });
});

// 注册：创建未验证用户并发验证邮件
router.post('/register', authLimiter, async (req, res) => {
  let { email, password, nickname, captchaToken } = req.body || {};
  email = (email || '').trim().toLowerCase();
  nickname = (nickname || '').trim();

  if (!validEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!nickname || nickname.length > 20) return res.status(400).json({ error: '昵称必填且不超过 20 字' });

  const captcha = await verifyTurnstile(captchaToken, req.ip);
  if (!captcha.ok) {
    console.warn('[register] 人机验证未通过：', captcha.code || captcha.codes, 'ip=', req.ip);
    return res.status(400).json({ error: '人机验证未通过，请刷新页面重试' });
  }

  const exists = db.prepare('SELECT id, verified FROM users WHERE email = ?').get(email);
  if (exists) {
    if (exists.verified) return res.status(409).json({ error: '该邮箱已注册' });
    // 未验证则允许重发（下方更新）
  }

  const hash = await bcrypt.hash(password, 10);
  const token = genToken();
  const expires = Date.now() + VERIFY_TTL;
  const now = Date.now();

  if (exists) {
    db.prepare(`UPDATE users SET password_hash=?, nickname=?, verify_token=?, verify_expires=? WHERE id=?`)
      .run(hash, nickname, token, expires, exists.id);
  } else {
    db.prepare(`INSERT INTO users (email, password_hash, nickname, verify_token, verify_expires, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(email, hash, nickname, token, expires, now);
  }

  const link = `${process.env.APP_URL}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
  try {
    await sendVerifyEmail(email, nickname, link);
  } catch (e) {
    console.error('[register] 发送验证邮件失败：', e.message);
    return res.status(502).json({ error: '验证邮件发送失败，请稍后重试或检查邮箱地址' });
  }

  res.json({ ok: true, message: '验证邮件已发送，请查收（可能在垃圾箱）' });
});

// 验证邮箱：点击邮件里的链接
router.get('/verify', (req, res) => {
  const { token, email } = req.query;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());

  const fail = (msg) => res.redirect(`/login.html?verify=fail&msg=${encodeURIComponent(msg)}`);

  if (!user || !user.verify_token || !safeEqual(user.verify_token, String(token || ''))) return fail('验证链接无效');
  if (user.verified) return res.redirect('/login.html?verify=already');
  if (!user.verify_expires || user.verify_expires < Date.now()) return fail('验证链接已过期，请重新注册');

  db.prepare('UPDATE users SET verified=1, verify_token=NULL, verify_expires=NULL WHERE id=?').run(user.id);
  res.redirect('/login.html?verify=ok');
});

// 登录
router.post('/login', authLimiter, async (req, res) => {
  let { email, password } = req.body || {};
  email = (email || '').trim().toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: '邮箱或密码错误' });

  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: '邮箱或密码错误' });
  if (!user.verified) return res.status(403).json({ error: '邮箱尚未验证，请先查收验证邮件' });

  setAuthCookie(res, sign(user));
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

module.exports = router;
