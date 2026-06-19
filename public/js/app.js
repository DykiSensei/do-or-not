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
  const { decided, result } = await api('/api/decision/today');
  if (decided) {
    showResultText(result);
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
  document.getElementById('spinHint').textContent = '明天再来转一次吧～';
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
      const r = u.results[d];
      const cls = r === 'lu' ? 'cell lu' : r === 'bulu' ? 'cell bulu' : 'cell';
      const title = `${d} · ${r ? (r === 'lu' ? '撸' : '不撸') : '未决定'}`;
      body += `<td><span class="${cls}" title="${title}"></span></td>`;
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

// ===== UI 绑定 =====
function bindUI() {
  document.getElementById('spinBtn').addEventListener('click', spin);

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
