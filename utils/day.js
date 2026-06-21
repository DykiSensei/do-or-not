// 统一的「今天」概念：YYYY-MM-DD，按用户时区算
// 默认 Asia/Shanghai；调用方按需传入用户时区（决定记录、提醒判断都得用各自用户的时区）
// 中国大陆无 DST，统计 lastNDays 用 86400000ms 步进；DST 时区在切换日附近可能跳一天，按需处理
const DEFAULT_TZ = 'Asia/Shanghai';
const fmtCache = new Map();
function getFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

function today(tz = DEFAULT_TZ) {
  return getFmt(tz).format(new Date());
}

// 返回最近 n 天的日期数组（含今天），升序
function lastNDays(n, tz = DEFAULT_TZ) {
  const out = [];
  const now = Date.now();
  const fmt = getFmt(tz);
  for (let i = n - 1; i >= 0; i--) {
    out.push(fmt.format(new Date(now - i * 86400000)));
  }
  return out;
}

module.exports = { today, lastNDays, DEFAULT_TZ };
