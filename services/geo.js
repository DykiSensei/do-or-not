// 用免费的 ip-api.com 查 IP 的时区 + 地区。免费版 45 次/分，对小圈子项目够用
// 私网 / 本机 IP 直接跳过；外部 IP 24h 内复用缓存；3 秒超时不阻塞发帖
const cache = new Map(); // ip -> { result, expiresAt }
const TTL = 24 * 60 * 60 * 1000;

const EMPTY = { timezone: null, country: null, region: null, city: null, label: null };

function isPrivate(ip) {
  if (!ip) return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip)) return true; // IPv6 ULA
  return false;
}

async function lookupIp(ip) {
  if (isPrivate(ip)) return EMPTY;
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,timezone&lang=zh-CN`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'success' || !data.timezone) {
      // 失败也短暂缓存一下，避免连环重试
      cache.set(ip, { result: EMPTY, expiresAt: Date.now() + 10 * 60 * 1000 });
      return EMPTY;
    }
    const result = {
      timezone: data.timezone,
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
      // 显示用：「中国 · 上海」/ 「United States · New York」；缺城市退到省/州
      label: [data.country, data.city || data.regionName].filter(Boolean).join(' · ') || null,
    };
    cache.set(ip, { result, expiresAt: Date.now() + TTL });
    return result;
  } catch (e) {
    console.error(`[geo] 查 ${ip} 失败：${e.message}`);
    return EMPTY;
  }
}

module.exports = { lookupIp };
