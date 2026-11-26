/*!
 * app-tabbar.js —— app 里的底部 Tab 栏
 *
 * 依赖 app-shell.js,放在它之后:
 *     <script src="/app-shell.js" defer></script>
 *     <script src="/app-tabbar.js" defer></script>
 *
 * 只在 app 里显示,浏览器访问网站时什么都不做。
 *
 * 这是 Apple Guideline 4.2 性价比最高的一项:成本低,而且是审核员第一眼就能看到
 * 的"这不是一个网页"信号。但要说清楚 —— 它改的是观感,不是"Safari 做不到的能力",
 * 所以不能只靠它顶 4.2,要配一个真能力(本项目配的是离线阅读)。
 *
 * ⚠ 下面 ITEMS 里的 href 和文字【必须】改成你站上真实存在的页面。
 *   指向死链是审核员十几分钟就能找到的问题,比没有 Tab 栏更糟。
 */
(function () {
  'use strict';

  var AppShell = window.AppShell;
  if (!AppShell || !AppShell.platform) return;   // 浏览器里 app-shell.js 不会建这个对象

  // ===================== 改这里 =====================
  var ITEMS = [
    // 测试站(GitHub Pages)上真存在的四个页。带 /webview-app/ 前缀是因为
    // Pages 服务在子路径下;换成你自己的域名(站在根目录)时把前缀去掉。
    { label: '诊断', href: '/webview-app/index.html', icon: 'home' },
    { label: '能力', href: '/webview-app/capabilities.html', icon: 'grid' },
    { label: '离线', href: '/webview-app/offline-test.html', icon: 'cart' },
    { label: '下载', href: '/webview-app/download.html', icon: 'user' },
  ];

  var CONFIG = {
    // 这些路径下不显示 Tab 栏(结算流程里不该有别的出口)
    hideOn: /^\/(checkout|pay)\b/i,
    activeColor: '#1565C0',   // 和 app.config.json 的 themeColor 保持一致
  };
  // =================================================

  var ICONS = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6M9 21h.01M18 21h.01',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 21a7.5 7.5 0 0 1 15 0',
  };

  var path = location.pathname;
  if (CONFIG.hideOn.test(path)) return;

  // ---------- 样式 ----------
  // --app-safe-bottom 由 app-shell.js 提供:safeArea 是 native 模式时它是 0
  // (原生已经让开了手势条),cover 模式时是真实值。两种模式这里都对。
  var BAR_H = 52;
  var style = document.createElement('style');
  style.textContent = [
    // box-sizing 必须是 border-box:height 里已经算进了 --app-safe-bottom,
    // 下面的 padding-bottom 又是同一个值。content-box 会把它加两遍 —— 栏高会比
    // 声明的多出一个 safe area(手势条机型上实测多 34px),底部内容和提示条都会被压住。
    '#app-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;box-sizing:border-box;',
    'display:flex;align-items:stretch;',
    'height:calc(' + BAR_H + 'px + var(--app-safe-bottom,0px));',
    'padding-bottom:var(--app-safe-bottom,0px);',
    'padding-left:var(--app-safe-left,0px);padding-right:var(--app-safe-right,0px);',
    'background:rgba(255,255,255,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);',
    'backdrop-filter:saturate(180%) blur(20px);',
    'border-top:1px solid rgba(0,0,0,.08);}',
    '@media (prefers-color-scheme:dark){#app-tabbar{background:rgba(22,22,24,.92);',
    'border-top-color:rgba(255,255,255,.1);}}',
    '#app-tabbar a{flex:1 1 0;min-width:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:2px;text-decoration:none;',
    'color:#8a8a8e;font:500 10px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC",',
    '"Microsoft YaHei",sans-serif;-webkit-tap-highlight-color:transparent;}',
    '#app-tabbar a.is-active{color:' + CONFIG.activeColor + ';}',
    '#app-tabbar a:active{opacity:.55;}',
    '#app-tabbar svg{width:23px;height:23px;}',
    '#app-tabbar span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    // 给页面留出 Tab 栏的高度,不然底部内容被压住
    '.in-app-tabbar body{padding-bottom:calc(' + BAR_H + 'px + var(--app-safe-bottom,0px));}',
  ].join('');
  document.head.appendChild(style);

  // ---------- 结构 ----------
  function isActive(href) {
    if (href === '/') return path === '/' || path === '/index.php' || path === '/index.html';
    return path === href || path.indexOf(href.replace(/\/$/, '') + '/') === 0;
  }

  function build() {
    if (document.getElementById('app-tabbar')) return;

    var nav = document.createElement('nav');
    nav.id = 'app-tabbar';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', '主导航');

    ITEMS.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      if (isActive(item.href)) {
        a.className = 'is-active';
        a.setAttribute('aria-current', 'page');
      }
      a.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="' + (ICONS[item.icon] || ICONS.home) + '"/></svg>';
      var label = document.createElement('span');
      label.textContent = item.label;   // 用 textContent,别让配置里的文字变成 HTML
      a.appendChild(label);
      nav.appendChild(a);
    });

    document.body.appendChild(nav);
    document.documentElement.classList.add('in-app-tabbar');

    // 告诉 app-shell.js 底部被占了多高 —— 它的提示条(返回键的「再按一次退出」、
    // 断网提示、下载提示)要让开,否则会压在 Tab 栏上面。
    // 用内联样式而不是 CSS 类:内联优先级最高,不依赖两个 <style> 的先后顺序。
    document.documentElement.style.setProperty('--app-bottom-inset', BAR_H + 'px');
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build, { once: true });
})();
