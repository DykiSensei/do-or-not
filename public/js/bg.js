// 随机二次元（风景）背景：加载成功才替换，失败则保持 CSS 里的渐变兜底。
// 换图床只需改 SRC（记得同步把域名加进 server.js 的 CSP img-src）。
(function () {
  const SRC = 'https://t.alcy.cc/fj'; // 二次元风景随机壁纸
  // 带时间戳：每次进页面换一张；预加载与 CSS 背景用同一 URL，避免取到两张不同的图
  const url = SRC + (SRC.includes('?') ? '&' : '?') + 't=' + Date.now();

  const img = new Image();
  img.onload = function () {
    // 图上叠一层半透明暗色，保证文字与卡片可读
    document.body.style.backgroundImage =
      'linear-gradient(rgba(15,14,23,.74), rgba(15,14,23,.82)), url("' + url + '")';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  };
  img.src = url; // onerror 不处理 → 自动保留渐变背景
})();
