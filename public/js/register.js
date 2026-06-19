const msg = document.getElementById('msg');
function showMsg(text, type) {
  msg.textContent = text;
  msg.className = 'msg show ' + type;
}

document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
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
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    showMsg(data.message || '验证邮件已发送，请查收邮箱（含垃圾箱）', 'ok');
    document.getElementById('regForm').reset();
  } catch (err) {
    showMsg(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});
