const msg = document.getElementById('msg');
function showMsg(text, type) {
  msg.textContent = text;
  msg.className = 'msg show ' + type;
}

// 处理邮箱验证回跳提示
const params = new URLSearchParams(location.search);
const v = params.get('verify');
if (v === 'ok') showMsg('邮箱验证成功，现在可以登录啦！', 'ok');
else if (v === 'already') showMsg('邮箱已验证过，直接登录即可', 'ok');
else if (v === 'fail') showMsg(params.get('msg') || '验证失败', 'err');

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    location.href = '/';
  } catch (err) {
    showMsg(err.message, 'err');
    btn.disabled = false;
  }
});
