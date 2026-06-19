// ===== 工具 =====
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('未登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// 没设头像时，用昵称首字生成一个彩色头像
function defaultAvatar(name) {
  const ch = (name || '?').trim()[0] || '?';
  const colors = ['#6c5ce7', '#ff6b81', '#2ed573', '#ffa502', '#1e90ff', '#e84393'];
  let h = 0; for (const c of (name || '')) h = (h + c.charCodeAt(0)) % colors.length;
  const bg = colors[h];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
    <rect width="64" height="64" rx="32" fill="${bg}"/>
    <text x="32" y="42" font-size="30" fill="#fff" text-anchor="middle" font-family="sans-serif">${ch}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function avatarUrl(u) { return u.avatar || defaultAvatar(u.nickname); }

// ===== 状态 =====
let me = null;
let wheelRotation = 0;
let spinning = false;
let ratioChart = null;
let currentDays = 14;
let currentPostId = null;

// ===== 初始化 =====
(async function init() {
  try {
    me = await api('/api/user/me');
  } catch { return; } // 已跳转登录
  document.getElementById('meName').textContent = me.nickname;
  document.getElementById('meAvatar').src = avatarUrl(me);

  await loadToday();
  await loadStats(currentDays);
  bindUI();
})();

// ===== 轮盘 =====
async function loadToday() {
  const { decided, result, photo } = await api('/api/decision/today');
  if (decided) {
    showResultText(result);
    showCheckin(photo);
    wheelRotation = wheelAngleFor(result);
    setRotation(wheelRotation, false); // 已决定：直接停在结果区，无动画
  }
}

function resultText(r) { return r === 'lu' ? '撸 🔴' : '不撸 🟢'; }

// 让对应结果的扇区中心停到顶部指针下：lu→右半(270°)，bulu→左半(90°)，带轻微抖动
function wheelAngleFor(result) {
  const center = result === 'lu' ? 270 : 90;
  const jitter = Math.random() * 80 - 40; // ±40°，仍落在对应半区内
  return center + jitter;
}

// 同时旋转色块和文字：文字作为轮盘子元素跟着转，再反向旋转以保持正向可读
function setRotation(deg, animate) {
  const wheel = document.getElementById('wheel');
  const labels = document.querySelectorAll('.wheel-label');
  if (!animate) {
    wheel.style.transition = 'none';
    labels.forEach((l) => (l.style.transition = 'none'));
  }
  wheel.style.transform = `rotate(${deg}deg)`;
  labels.forEach((l) => (l.style.transform = `translate(-50%, -50%) rotate(${-deg}deg)`));
  if (!animate) {
    void wheel.offsetWidth; // 强制重排，避免恢复过渡时把瞬时定位也做成动画
    requestAnimationFrame(() => {
      wheel.style.transition = '';
      labels.forEach((l) => (l.style.transition = ''));
    });
  }
}

function showResultText(result) {
  const big = document.getElementById('resultBig');
  big.textContent = '今天：' + resultText(result);
  big.className = 'result-big ' + result;
  const btn = document.getElementById('spinBtn');
  btn.disabled = true;
  btn.textContent = '今天已揭晓';
  document.getElementById('spinHint').textContent = '明天再来决定一次吧～';
  // 决定后隐藏手动选择按钮
  document.getElementById('manualBox').style.display = 'none';
}

// 决定之后展示打卡区；若已传过照片则回显
function showCheckin(photo) {
  document.getElementById('checkinBox').style.display = 'block';
  const img = document.getElementById('checkinPhoto');
  const pick = document.getElementById('pickPhoto');
  if (photo) {
    img.src = photo;
    img.style.display = 'block';
    pick.textContent = '重新上传打卡照片';
  } else {
    img.style.display = 'none';
    pick.textContent = '上传打卡照片';
  }
}

// 手动选择今天的结果
async function choose(result) {
  if (spinning) return;
  document.getElementById('chooseLu').disabled = true;
  document.getElementById('chooseBulu').disabled = true;
  try {
    await api('/api/decision/choose', { method: 'POST', body: JSON.stringify({ result }) });
  } catch (err) {
    document.getElementById('spinHint').textContent = err.message;
    document.getElementById('chooseLu').disabled = false;
    document.getElementById('chooseBulu').disabled = false;
    return;
  }
  showResultText(result);
  showCheckin(null);
  wheelRotation = wheelAngleFor(result);
  setRotation(wheelRotation, true); // 转过去停在所选结果上
  await loadStats(currentDays);
}

async function spin() {
  if (spinning) return;
  spinning = true;
  const btn = document.getElementById('spinBtn');
  btn.disabled = true;
  document.getElementById('resultBig').textContent = '';

  let data;
  try {
    data = await api('/api/decision/spin', { method: 'POST' });
  } catch (err) {
    // 可能今天已经转过（并发/多端）
    document.getElementById('spinHint').textContent = err.message;
    btn.disabled = false;
    spinning = false;
    return;
  }

  // 在当前角度上至少再转 5 整圈，精准停到结果扇区中心（一次性算好，避免收尾突跳）
  const rest = wheelAngleFor(data.result);
  const current = ((wheelRotation % 360) + 360) % 360;
  const delta = (((rest - current) % 360) + 360) % 360;
  wheelRotation += 360 * 5 + delta;
  setRotation(wheelRotation, true);

  setTimeout(async () => {
    showResultText(data.result);
    showCheckin(null);
    spinning = false;
    await loadStats(currentDays); // 刷新统计
  }, 4100);
}

// ===== 统计 =====
async function loadStats(days) {
  const data = await api('/api/stats/overview?days=' + days);
  renderGrid(data);
  renderChart(data);
}

function renderGrid({ days, users }) {
  const table = document.getElementById('gridTable');
  // 表头：日期（只显示月-日）
  let head = '<tr><th class="userc"></th>';
  for (const d of days) head += `<th class="daycol">${d.slice(5)}</th>`;
  head += '<th></th></tr>';

  let body = '';
  for (const u of users) {
    body += `<tr><td class="userc"><img src="${avatarUrl(u)}" alt="">${escapeHtml(u.nickname)}</td>`;
    for (const d of days) {
      const r = u.results[d]; // { result, mode, photo } 或 undefined
      const res = r && r.result;
      const cls = res === 'lu' ? 'cell lu' : res === 'bulu' ? 'cell bulu' : 'cell';
      const modeTxt = r ? (r.mode === 'manual' ? '手动' : '轮盘') : '';
      const cmtTxt = r && r.comments ? ` · ${r.comments} 条评论` : '';
      const title = `${d} · ${res ? (res === 'lu' ? '撸' : '不撸') + ' · ' + modeTxt : '未决定'}${r && r.photo ? ' · 已打卡' : ''}${cmtTxt}`;
      const cam = r && r.photo
        ? `<span class="cam" data-id="${r.id}" data-photo="${escapeHtml(r.photo)}" data-cap="${escapeHtml(u.nickname + ' · ' + d + ' · ' + (res === 'lu' ? '撸' : '不撸'))}" title="${title}">📷${r.comments ? `<b class="cam-n">${r.comments}</b>` : ''}</span>`
        : '';
      body += `<td><span class="${cls}" title="${title}">${cam}</span></td>`;
    }
    const ratio = u.total ? Math.round((u.luCount / u.total) * 100) : 0;
    body += `<td class="ratio">${u.luCount}/${u.total} (${ratio}%)</td></tr>`;
  }
  table.innerHTML = head + body;
}

function renderChart({ users }) {
  const labels = users.map((u) => u.nickname);
  const data = users.map((u) => (u.total ? Math.round((u.luCount / u.total) * 100) : 0));
  const ctx = document.getElementById('ratioChart');
  if (ratioChart) ratioChart.destroy();
  ratioChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '撸率 %',
        data,
        backgroundColor: '#ff6b81',
        borderRadius: 6,
      }],
    },
    options: {
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => `撸率 ${c.raw}%` } } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { color: '#8b87a3', callback: (v) => v + '%' }, grid: { color: '#2a2740' } },
        x: { ticks: { color: '#e8e6f0' }, grid: { display: false } },
      },
    },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 打卡帖 + 评论 =====
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openPost(id, photo, cap) {
  currentPostId = id;
  document.getElementById('photoBig').src = photo;
  document.getElementById('photoCap').textContent = cap;
  document.getElementById('commentMsg').className = 'msg';
  document.getElementById('commentInput').value = '';
  document.getElementById('commentList').innerHTML = '<div class="cmt-empty">加载中…</div>';
  document.getElementById('photoModal').classList.add('show');
  loadComments(id);
}

function closePost() {
  document.getElementById('photoModal').classList.remove('show');
  currentPostId = null;
}

async function loadComments(id) {
  if (!id) return;
  let data;
  try {
    data = await api('/api/comments/' + id);
  } catch (err) {
    document.getElementById('commentList').innerHTML =
      `<div class="cmt-empty">加载失败：${escapeHtml(err.message)}</div>`;
    return;
  }
  if (id !== currentPostId) return; // 期间已切换/关闭
  renderComments(data.comments);
}

function renderComments(list) {
  const box = document.getElementById('commentList');
  if (!list.length) {
    box.innerHTML = '<div class="cmt-empty">还没有评论，来抢沙发 🛋️</div>';
    return;
  }
  box.innerHTML = list.map((c) => {
    const av = avatarUrl({ avatar: c.avatar, nickname: c.nickname });
    const del = c.user_id === me.id
      ? `<button class="cmt-del" data-id="${c.id}" title="删除">删除</button>` : '';
    return `<div class="cmt">
      <img class="cmt-av" src="${av}" alt="">
      <div class="cmt-main">
        <div class="cmt-head"><b>${escapeHtml(c.nickname)}</b><span>${fmtTime(c.created_at)}</span>${del}</div>
        <div class="cmt-body">${escapeHtml(c.body)}</div>
      </div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendComment() {
  const input = document.getElementById('commentInput');
  const body = input.value.trim();
  const msg = document.getElementById('commentMsg');
  if (!body) return;
  if (!currentPostId) return;
  document.getElementById('commentSend').disabled = true;
  try {
    await api('/api/comments/' + currentPostId, { method: 'POST', body: JSON.stringify({ body }) });
    input.value = '';
    msg.className = 'msg';
    await loadComments(currentPostId);
    await loadStats(currentDays); // 更新网格评论数角标
  } catch (err) {
    msg.textContent = err.message; msg.className = 'msg show err';
  } finally {
    document.getElementById('commentSend').disabled = false;
  }
}

// ===== UI 绑定 =====
function bindUI() {
  document.getElementById('spinBtn').addEventListener('click', spin);
  document.getElementById('chooseLu').addEventListener('click', () => choose('lu'));
  document.getElementById('chooseBulu').addEventListener('click', () => choose('bulu'));

  // 打卡照片上传
  document.getElementById('pickPhoto').addEventListener('click', () => document.getElementById('photoFile').click());
  document.getElementById('photoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    const msg = document.getElementById('checkinMsg');
    try {
      const res = await fetch('/api/decision/photo', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      showCheckin(data.photo);
      msg.textContent = '打卡成功！'; msg.className = 'msg show ok';
      await loadStats(currentDays);
    } catch (err) {
      msg.textContent = err.message; msg.className = 'msg show err';
    }
    e.target.value = ''; // 允许再次选同一文件
  });

  // 点网格里的 📷 打开打卡帖（照片 + 评论）
  const photoModal = document.getElementById('photoModal');
  document.getElementById('gridTable').addEventListener('click', (e) => {
    const cam = e.target.closest('.cam');
    if (!cam) return;
    openPost(cam.dataset.id, cam.dataset.photo, cam.dataset.cap);
  });
  // 只在点遮罩或关闭按钮时收起；帖子内部点击不关闭
  photoModal.addEventListener('click', (e) => { if (e.target === photoModal) closePost(); });
  document.getElementById('postClose').addEventListener('click', closePost);

  // 发表评论
  document.getElementById('commentSend').addEventListener('click', sendComment);
  document.getElementById('commentInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendComment(); }
  });
  // 删除自己的评论（事件委托）
  document.getElementById('commentList').addEventListener('click', async (e) => {
    const del = e.target.closest('.cmt-del');
    if (!del) return;
    if (!confirm('删除这条评论？')) return;
    try {
      await api('/api/comments/' + del.dataset.id, { method: 'DELETE' });
      await loadComments(currentPostId);
      await loadStats(currentDays);
    } catch (err) {
      const msg = document.getElementById('commentMsg');
      msg.textContent = err.message; msg.className = 'msg show err';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  // 日期范围切换
  document.querySelectorAll('#rangeTabs .tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#rangeTabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentDays = parseInt(tab.dataset.days, 10);
      await loadStats(currentDays);
    });
  });

  // 设置弹层
  const modal = document.getElementById('modalBg');
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('editNickname').value = me.nickname;
    document.getElementById('editAvatar').src = avatarUrl(me);
    document.getElementById('settingsMsg').className = 'msg';
    modal.classList.add('show');
  });
  document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

  // 选头像
  document.getElementById('pickAvatar').addEventListener('click', () => document.getElementById('avatarFile').click());
  document.getElementById('avatarFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    const msg = document.getElementById('settingsMsg');
    try {
      const res = await fetch('/api/user/avatar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      me.avatar = data.avatar;
      document.getElementById('editAvatar').src = data.avatar;
      document.getElementById('meAvatar').src = data.avatar;
      msg.textContent = '头像已更新'; msg.className = 'msg show ok';
      await loadStats(currentDays);
    } catch (err) {
      msg.textContent = err.message; msg.className = 'msg show err';
    }
  });

  // 保存昵称
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const nickname = document.getElementById('editNickname').value.trim();
    const msg = document.getElementById('settingsMsg');
    try {
      const data = await api('/api/user/nickname', { method: 'PUT', body: JSON.stringify({ nickname }) });
      me.nickname = data.nickname;
      document.getElementById('meName').textContent = data.nickname;
      if (!me.avatar) document.getElementById('meAvatar').src = avatarUrl(me);
      msg.textContent = '已保存'; msg.className = 'msg show ok';
      await loadStats(currentDays);
    } catch (err) {
      msg.textContent = err.message; msg.className = 'msg show err';
    }
  });
}
