const msg = document.getElementById('msg');
function showMsg(text, type) {
  msg.textContent = text;
  msg.className = 'msg show ' + type;
}

// Turnstile 状态
let captchaRequired = false;
let captchaToken = null;
let captchaWidgetId = null;

// 页面加载时先问后端是否启用、用什么 site key；启用则动态注入 Turnstile 脚本
(async () => {
  try {
    const r = await fetch('/api/auth/captcha-config');
    const { siteKey } = await r.json();
    if (!siteKey) return;
    captchaRequired = true;

    window.__onCfReady = () => {
      if (!window.turnstile) return;
      captchaWidgetId = window.turnstile.render('#cfTurnstile', {
        sitekey: siteKey,
        theme: 'dark',
        callback: (t) => { captchaToken = t; },
        'expired-callback': () => { captchaToken = null; },
        'error-callback': () => { captchaToken = null; },
      });
    };

    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__onCfReady';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  } catch (e) {
    console.warn('captcha 配置加载失败：', e);
  }
})();

function resetCaptcha() {
  captchaToken = null;
  if (captchaWidgetId !== null && window.turnstile) {
    try { window.turnstile.reset(captchaWidgetId); } catch {}
  }
}

document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (captchaRequired && !captchaToken) {
    showMsg('请先完成下方人机验证', 'err');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: document.getElementById('nickname').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        captchaToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    showMsg(data.message || '验证邮件已发送，请查收邮箱（含垃圾箱）', 'ok');
    document.getElementById('regForm').reset();
    resetCaptcha();
  } catch (err) {
    showMsg(err.message, 'err');
    resetCaptcha(); // token 是一次性的，失败也得换一张
  } finally {
    btn.disabled = false;
  }
});
