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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function resultText(r) { return r === 'lu' ? '撸 🔴' : '不撸 🟢'; }

// ===== 状态 =====
let me = null;
let wheelRotation = 0;
let spinning = false;
let ratioChart = null;
let currentDays = 14;
let pendingPhoto = null;           // 待发布的配图文件
const feedPosts = new Map();        // id -> post，便于局部刷新评论
let feedCursor = 0;                 // 已加载的最小帖子 id
let feedLoading = false;
let feedCollapsed = true;           // 默认折叠：只显示最近 FEED_VISIBLE 条
let feedHasMore = false;
const FEED_VISIBLE = 3;

// ===== 初始化 =====
(async function init() {
  try {
    me = await api('/api/user/me');
  } catch { return; } // 已跳转登录
  document.getElementById('meName').textContent = me.nickname;
  document.getElementById('meAvatar').src = avatarUrl(me);

  await loadToday();
  await loadFeed(true);
  await loadStats(currentDays);
  bindUI();
})();

// ===== 轮盘 / 决定 =====
async function loadToday() {
  const { decided, result, photo, note } = await api('/api/decision/today');
  if (decided) {
    showResultText(result);
    showCheckin(photo, note);
    wheelRotation = wheelAngleFor(result);
    setRotation(wheelRotation, false); // 已决定：直接停在结果区，无动画
  }
}

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
  document.getElementById('manualBox').style.display = 'none';
}

// 决定之后展示打卡输入区，并回显已有的文字 / 配图
function showCheckin(photo, note) {
  document.getElementById('checkinBox').style.display = 'block';
  document.getElementById('noteInput').value = note || '';
  pendingPhoto = null;
  const img = document.getElementById('checkinPhoto');
  if (photo) { img.src = photo; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}

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
  showCheckin(null, null);
  wheelRotation = wheelAngleFor(result);
  setRotation(wheelRotation, true);
  await loadFeed(true);
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
    showCheckin(null, null);
    spinning = false;
    await loadFeed(true);
    await loadStats(currentDays);
  }, 4100);
}

// 发布今日打卡（文字 + 可选配图）
async function publishCheckin() {
  const btn = document.getElementById('publishCheckin');
  const msg = document.getElementById('checkinMsg');
  const note = document.getElementById('noteInput').value.trim();
  if (!note && !pendingPhoto && document.getElementById('checkinPhoto').style.display === 'none') {
    msg.textContent = '写点文字或配张图再发布吧'; msg.className = 'msg show err';
    return;
  }
  const fd = new FormData();
  fd.append('note', note);
  if (pendingPhoto) fd.append('photo', pendingPhoto);

  btn.disabled = true;
  try {
    const res = await fetch('/api/decision/checkin', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '发布失败');
    pendingPhoto = null;
    const img = document.getElementById('checkinPhoto');
    if (data.photo) { img.src = data.photo; img.style.display = 'block'; }
    msg.textContent = '已发布到动态！'; msg.className = 'msg show ok';
    await loadFeed(true);
    await loadStats(currentDays);
  } catch (err) {
    msg.textContent = err.message; msg.className = 'msg show err';
  } finally {
    btn.disabled = false;
  }
}

// ===== 信息流 =====
async function loadFeed(reset) {
  if (feedLoading) return;
  feedLoading = true;
  if (reset) { feedCursor = 0; feedPosts.clear(); document.getElementById('feed').innerHTML = ''; }
  let data;
  try {
    data = await api('/api/feed?limit=20' + (feedCursor ? '&before=' + feedCursor : ''));
  } catch { feedLoading = false; return; }

  const feed = document.getElementById('feed');
  for (const p of data.posts) {
    feedPosts.set(p.id, p);
    feed.insertAdjacentHTML('beforeend', postHtml(p));
    maybeCollapsePostBody(feed.lastElementChild);
    feedCursor = p.id; // 倒序，最后一条即最小 id
  }
  if (reset && data.posts.length === 0) {
    feed.innerHTML = '<div class="cmt-empty">还没有人打卡，快去转个轮盘吧 🎰</div>';
  }
  feedHasMore = data.hasMore;
  updateFeedView();
  feedLoading = false;
}

// 控制整个 feed 卡片的折叠 / 加载更多 / 到底提示，按 feedCollapsed 与已加载数量决定显示
function updateFeedView() {
  const feed = document.getElementById('feed');
  const toggle = document.getElementById('feedToggle');
  const loadMore = document.getElementById('loadMore');
  const feedEnd = document.getElementById('feedEnd');
  const total = feedPosts.size;

  if (total === 0) {
    feed.classList.remove('collapsed');
    toggle.style.display = 'none';
    loadMore.style.display = 'none';
    feedEnd.style.display = 'none';
    return;
  }

  // 已加载 + 还能再翻的，都算「可展开的」总量
  const expandable = total > FEED_VISIBLE || feedHasMore;

  if (feedCollapsed && expandable) {
    feed.classList.add('collapsed');
    toggle.style.display = 'block';
    const hidden = Math.max(total - FEED_VISIBLE, 0);
    toggle.textContent = hidden > 0 ? `展开剩余 ${hidden} 条动态` : '展开全部动态';
    loadMore.style.display = 'none';
    feedEnd.style.display = 'none';
  } else {
    feed.classList.remove('collapsed');
    toggle.style.display = expandable ? 'block' : 'none';
    toggle.textContent = '收起动态';
    loadMore.style.display = feedHasMore ? 'block' : 'none';
    feedEnd.style.display = (!feedHasMore && total > 0) ? 'block' : 'none';
  }
}

function postHtml(p) {
  const av = avatarUrl(p.user);
  const badge = `<span class="badge ${p.result}">${p.result === 'lu' ? '撸' : '不撸'}</span>`;
  const modeTxt = p.mode === 'manual' ? '手动' : '轮盘';
  const note = p.note ? `<div class="post-note">${escapeHtml(p.note)}</div>` : '';
  const photo = p.photo
    ? `<img class="post-img" src="${escapeHtml(p.photo)}" alt="打卡照片" data-photo="${escapeHtml(p.photo)}">` : '';
  const body = (note || photo)
    ? `<div class="post-body">${note}${photo}</div><button class="post-expand" type="button">展开</button>`
    : '';
  const loc = p.location ? ` · 📍 ${escapeHtml(p.location)}` : '';
  return `<div class="post-card" data-id="${p.id}">
    <div class="post-top">
      <img class="post-av" src="${av}" alt="">
      <div class="post-meta">
        <div class="post-name">${escapeHtml(p.user.nickname)} ${badge}</div>
        <div class="post-time">${fmtTime(p.created_at)} · ${modeTxt}决定${loc}</div>
      </div>
    </div>
    ${body}
    <div class="post-cmts">${commentsHtml(p.comments)}</div>
    <div class="comment-form">
      <input class="cmt-in" type="text" maxlength="500" placeholder="写条评论…" autocomplete="off">
      <button class="btn cmt-send">发送</button>
    </div>
  </div>`;
}

// 量帖子体积，决定是否显示「展开」+ 底部渐变。
// 用 ResizeObserver 兜底：图片异步加载、被折叠的帖子展开后变可见、窗口缩放，都会触发重新量
function maybeCollapsePostBody(card) {
  const body = card.querySelector('.post-body');
  if (!body) return;
  const btn = card.querySelector('.post-expand');
  const check = () => {
    if (body.classList.contains('expanded')) return;
    // 元素被 display:none 隐藏时 scrollHeight = 0，跳过避免错判为不溢出
    if (body.clientHeight === 0) return;
    const overflow = body.scrollHeight > body.clientHeight + 1;
    body.classList.toggle('has-more', overflow);
    btn.classList.toggle('show', overflow);
  };
  check();
  // 注意：post-card 始终在 DOM 里，ResizeObserver 在元素从 display:none 变可见时也会触发一次
  new ResizeObserver(check).observe(body);
}

// 按线程渲染：顶层评论后紧跟它的所有后代回复（扁平 + 缩进 + @ 前缀指明回复对象）
function commentsHtml(list) {
  if (!list.length) return '';
  const byId = new Map(list.map((c) => [c.id, c]));

  const rootOf = (c) => {
    let cur = c;
    while (cur.parent_id && byId.has(cur.parent_id)) cur = byId.get(cur.parent_id);
    return cur;
  };

  // 按 root 分组，组内保留原顺序（时间正序）
  const groups = new Map();
  for (const c of list) {
    const rootId = rootOf(c).id;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(c);
  }

  const out = [];
  for (const [rootId, group] of groups) {
    for (const c of group) {
      const isReply = c.id !== rootId;
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      // 只有「回复了另一条回复」才标 @，回复顶层评论本身就在它下面、不需要重复
      const at = isReply && parent && parent.id !== rootId ? parent.nickname : null;
      out.push(commentHtml(c, isReply, at));
    }
  }
  return out.join('');
}

function commentHtml(c, isReply, atName) {
  const av = avatarUrl({ avatar: c.avatar, nickname: c.nickname });
  const replyBtn = `<button class="cmt-reply-btn" data-id="${c.id}" data-name="${escapeHtml(c.nickname)}">回复</button>`;
  const del = c.user_id === me.id
    ? `<button class="cmt-del" data-id="${c.id}" title="删除">删除</button>` : '';
  const at = atName ? `<span class="cmt-at">@${escapeHtml(atName)}</span> ` : '';
  return `<div class="cmt${isReply ? ' cmt-child' : ''}" data-cid="${c.id}">
    <img class="cmt-av" src="${av}" alt="">
    <div class="cmt-main">
      <div class="cmt-head"><b>${escapeHtml(c.nickname)}</b><span>${fmtTime(c.created_at)}</span>${replyBtn}${del}</div>
      <div class="cmt-body">${at}${escapeHtml(c.body)}</div>
    </div>
  </div>`;
}

function refreshPostComments(postId) {
  const card = document.querySelector(`.post-card[data-id="${postId}"]`);
  if (!card) return;
  card.querySelector('.post-cmts').innerHTML = commentsHtml(feedPosts.get(postId).comments);
}

async function addComment(postId, inputEl, parentId) {
  const body = inputEl.value.trim();
  if (!body) return;
  inputEl.disabled = true;
  try {
    const payload = parentId ? { body, parent_id: parentId } : { body };
    const data = await api('/api/comments/' + postId, { method: 'POST', body: JSON.stringify(payload) });
    const post = feedPosts.get(postId);
    if (post) { post.comments.push(data.comment); refreshPostComments(postId); }
    inputEl.value = '';
    await loadStats(currentDays); // 更新网格评论数角标
    return true;
  } catch (err) {
    alert(err.message);
    return false;
  } finally {
    inputEl.disabled = false;
  }
}

async function deleteComment(postId, commentId) {
  try {
    const data = await api('/api/comments/' + commentId, { method: 'DELETE' });
    const post = feedPosts.get(postId);
    if (post) {
      const deletedSet = new Set(data.deleted || [commentId]);
      post.comments = post.comments.filter((c) => !deletedSet.has(c.id));
      refreshPostComments(postId);
    }
    await loadStats(currentDays);
  } catch (err) {
    alert(err.message);
  }
}

// 同一时刻只允许一个内联回复框：先关掉其他的，再在目标评论后插一个新的
function openReplyForm(card, targetCmt, parentId, parentName) {
  document.querySelectorAll('.cmt-reply-form').forEach((f) => f.remove());
  const form = document.createElement('div');
  form.className = 'cmt-reply-form';
  form.dataset.parent = String(parentId);
  form.innerHTML = `
    <input type="text" maxlength="500" placeholder="回复 @${parentName}…" autocomplete="off">
    <button class="cmt-reply-send" type="button">发送</button>
    <button class="cmt-reply-cancel" type="button">取消</button>`;
  targetCmt.insertAdjacentElement('afterend', form);
  form.querySelector('input').focus();
}

async function submitReplyForm(form) {
  const card = form.closest('.post-card');
  const postId = parseInt(card.dataset.id, 10);
  const parentId = parseInt(form.dataset.parent, 10);
  const input = form.querySelector('input');
  const ok = await addComment(postId, input, parentId);
  if (ok) form.remove(); // 成功才关掉表单，失败保留让用户重试
}

// ===== 统计 =====
async function loadStats(days) {
  const data = await api('/api/stats/overview?days=' + days);
  renderGrid(data);
  renderChart(data);
}

function renderGrid({ days, users }) {
  const table = document.getElementById('gridTable');
  let head = '<tr><th class="userc"></th>';
  for (const d of days) head += `<th class="daycol">${d.slice(5)}</th>`;
  head += '<th></th></tr>';

  let body = '';
  for (const u of users) {
    body += `<tr><td class="userc"><img src="${avatarUrl(u)}" alt="">${escapeHtml(u.nickname)}</td>`;
    for (const d of days) {
      const r = u.results[d]; // { id, result, mode, photo, comments } 或 undefined
      const res = r && r.result;
      const cls = res === 'lu' ? 'cell lu' : res === 'bulu' ? 'cell bulu' : 'cell';
      const modeTxt = r ? (r.mode === 'manual' ? '手动' : '轮盘') : '';
      const cmtTxt = r && r.comments ? ` · ${r.comments} 条评论` : '';
      const title = `${d} · ${res ? (res === 'lu' ? '撸' : '不撸') + ' · ' + modeTxt : '未决定'}${r && r.photo ? ' · 有图' : ''}${cmtTxt}`;
      const cam = r && r.photo
        ? `<span class="cam" data-photo="${escapeHtml(r.photo)}" title="${title}">📷${r.comments ? `<b class="cam-n">${r.comments}</b>` : ''}</span>`
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

// ===== 看大图 =====
function openImage(src) {
  document.getElementById('photoBig').src = src;
  document.getElementById('photoModal').classList.add('show');
}

// ===== UI 绑定 =====
function bindUI() {
  document.getElementById('spinBtn').addEventListener('click', spin);
  document.getElementById('chooseLu').addEventListener('click', () => choose('lu'));
  document.getElementById('chooseBulu').addEventListener('click', () => choose('bulu'));

  // 打卡：选配图 + 发布
  document.getElementById('pickPhoto').addEventListener('click', () => document.getElementById('photoFile').click());
  document.getElementById('photoFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhoto = file;
    const img = document.getElementById('checkinPhoto');
    img.src = URL.createObjectURL(file);
    img.style.display = 'block';
    e.target.value = '';
  });
  document.getElementById('publishCheckin').addEventListener('click', publishCheckin);

  // 信息流加载更多
  document.getElementById('loadMore').addEventListener('click', () => loadFeed(false));

  // 信息流整体折叠 / 展开
  document.getElementById('feedToggle').addEventListener('click', () => {
    feedCollapsed = !feedCollapsed;
    updateFeedView();
  });

  // 信息流内的交互（事件委托）
  const feed = document.getElementById('feed');
  feed.addEventListener('click', (e) => {
    const img = e.target.closest('.post-img');
    if (img) { openImage(img.dataset.photo); return; }

    const expand = e.target.closest('.post-expand');
    if (expand) {
      const body = expand.previousElementSibling; // .post-body.collapsible
      const expanded = body.classList.toggle('expanded');
      expand.textContent = expanded ? '收起' : '展开';
      return;
    }

    const send = e.target.closest('.cmt-send');
    if (send) {
      const card = send.closest('.post-card');
      addComment(parseInt(card.dataset.id, 10), card.querySelector('.cmt-in'));
      return;
    }
    const replyBtn = e.target.closest('.cmt-reply-btn');
    if (replyBtn) {
      const card = replyBtn.closest('.post-card');
      const targetCmt = replyBtn.closest('.cmt');
      openReplyForm(card, targetCmt, parseInt(replyBtn.dataset.id, 10), replyBtn.dataset.name);
      return;
    }
    const replySend = e.target.closest('.cmt-reply-send');
    if (replySend) { submitReplyForm(replySend.closest('.cmt-reply-form')); return; }
    const replyCancel = e.target.closest('.cmt-reply-cancel');
    if (replyCancel) { replyCancel.closest('.cmt-reply-form').remove(); return; }

    const del = e.target.closest('.cmt-del');
    if (del) {
      const card = del.closest('.post-card');
      if (confirm('删除这条评论？\n（如果它有回复，回复也会一起删掉）')) {
        deleteComment(parseInt(card.dataset.id, 10), parseInt(del.dataset.id, 10));
      }
    }
  });
  feed.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const replyInput = e.target.closest('.cmt-reply-form input');
    if (replyInput) {
      e.preventDefault();
      submitReplyForm(replyInput.closest('.cmt-reply-form'));
      return;
    }
    const input = e.target.closest('.cmt-in');
    if (!input) return;
    e.preventDefault();
    const card = input.closest('.post-card');
    addComment(parseInt(card.dataset.id, 10), input);
  });

  // 看大图：网格 📷 与遮罩
  document.getElementById('gridTable').addEventListener('click', (e) => {
    const cam = e.target.closest('.cam');
    if (cam) openImage(cam.dataset.photo);
  });
  const photoModal = document.getElementById('photoModal');
  photoModal.addEventListener('click', () => photoModal.classList.remove('show'));

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
      await loadFeed(true);
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
      await loadFeed(true);
      await loadStats(currentDays);
    } catch (err) {
      msg.textContent = err.message; msg.className = 'msg show err';
    }
  });
}
