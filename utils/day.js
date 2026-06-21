// 统一的「今天」概念：按 Asia/Shanghai 计算 YYYY-MM-DD（中国大陆无 DST，一天恒为 86400000ms）
// 服务器常是 UTC，若按本地时间算，北京时间 0:00–7:59 的决定会被记到前一天
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function today() {
  return fmt.format(new Date());
}

// 返回最近 n 天的日期数组（含今天），升序
function lastNDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(fmt.format(new Date(now - i * 86400000)));
  }
  return out;
}

module.exports = { today, lastNDays };
