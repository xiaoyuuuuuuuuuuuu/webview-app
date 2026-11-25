/*!
 * app-shell.js —— 把网站在 app 里的体验补成「原生」
 *
 * 放到网站上,在 </body> 前引用一次:
 *     <script src="/app-shell.js" defer></script>
 *
 * 在普通浏览器里这个脚本什么都不做(第 1 个判断就 return 了),
 * 所以可以无条件加到所有页面,不会影响网站本身。
 *
 * 它负责 Capacitor 原生层做不到的那几件事:
 *   1. 收起启动页(不然会停在 splash 上)
 *   2. 安卓返回键 —— 不接的话在首页按返回 app 会卡住不退出
 *   3. 下拉刷新
 *   4. 断网/恢复的提示条
 *   5. target="_blank" 的链接(安卓 WebView 默认点了没反应)
 *   6. iOS 上的文件下载(安卓走原生 DownloadManager,不经过这里)
 *   7. safe area:统一成 --app-safe-* 四个 CSS 变量,给网站 CSS 用
 *   8. 深度链接:从外部点进来时跳到对应页面
 *   9. 离线缓存:只在 app 里注册 /sw.js,浏览器访问网站不受影响
 *  10. 给 <html> 加 class,方便网站 CSS 针对 app 做调整
 */
(function () {
  'use strict';

  // ===================== 可调项 =====================
  var CONFIG = {
    pullToRefresh: true,      // 下拉刷新
    backButton: true,         // 接管安卓返回键
    doubleTapToExit: true,    // 首页再按一次返回才退出(防误触)
    exitHintText: '再按一次退出',
    offlineText: '网络已断开',
    onlineText: '网络已恢复',
    externalInAppBrowser: true, // 外链用应用内浏览器(false = 丢给系统浏览器)
    hideSplashDelay: 0,        // 收起启动页前多等几毫秒,给网站渲染时间
    // safe area。要和 app.config.json 的 safeArea 保持一致:
    //   'native' —— 原生把 WebView 让开系统栏,网站什么都不用做(默认)
    //   'cover'  —— 内容铺到屏幕边缘,网站 CSS 必须自己用 --app-safe-* 让开
    // 最好是直接在网站的 <meta name="viewport"> 里写上 viewport-fit=cover,
    // 这里改只是兜底(脚本是 defer 的,改完会多一次重排)。
    safeArea: 'native',
    // 离线缓存。只在 app 里注册,所以不会影响浏览器访问你的网站。
    // sw.js 必须放在网站根目录,否则拿不到 '/' 作用域。
    offlineCache: true,
    serviceWorkerUrl: '/sw.js',
    // iOS 的下载链接交给系统浏览器(安卓有原生 DownloadManager,不走这里)
    interceptDownloadsOnIOS: true,
    downloadExtensions: /\.(pdf|xlsx?|docx?|csv|zip|rar|7z|pptx?|apk|ipa|dmg|mp4|mp3)$/i,
  };
  // =================================================

  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return; // 浏览器里直接退出

  var platform = Cap.getPlatform ? Cap.getPlatform() : 'unknown';
  var root = document.documentElement;
  root.classList.add('in-app', 'in-app-' + platform);

  // 调原生插件的薄封装。插件没装/调用失败都不能让网站崩,所以全部吞掉错误。
  function call(plugin, method, options) {
    try {
      if (!Cap.nativePromise) return Promise.resolve(null);
      return Cap.nativePromise(plugin, method, options || {}).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  function listen(plugin, event, cb) {
    try {
      if (Cap.addListener) Cap.addListener(plugin, event, cb);
    } catch (e) { /* 插件不可用就算了 */ }
  }

  // 同站判断。外链分流和深度链接两处都用,所以放在这一层。
  var baseHost = location.hostname.replace(/^www\./, '');
  function isSameSite(host) {
    var h = String(host || '').replace(/^www\./, '');
    return h === baseHost || h.endsWith('.' + baseHost);
  }

  // ---------- 样式 ----------
  var style = document.createElement('style');
  style.textContent = [
    '.in-app { -webkit-tap-highlight-color: transparent; }',
    '#app-shell-toast{position:fixed;left:50%;bottom:calc(24px + var(--app-safe-bottom));',
    'transform:translate(-50%,16px);z-index:2147483000;max-width:80vw;',
    'padding:10px 18px;border-radius:999px;background:rgba(24,24,27,.92);color:#fff;',
    'font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
    'text-align:center;opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;}',
    '#app-shell-toast.show{opacity:1;transform:translate(-50%,0);}',
    '#app-shell-ptr{position:fixed;top:var(--app-safe-top);left:50%;z-index:2147483000;',
    'width:30px;height:30px;margin-left:-15px;pointer-events:none;opacity:0;',
    'transition:opacity .15s;display:flex;align-items:center;justify-content:center;}',
    '#app-shell-ptr svg{width:22px;height:22px;}',
    '#app-shell-ptr.spin svg{animation:app-shell-spin .7s linear infinite;}',
    '@keyframes app-shell-spin{to{transform:rotate(360deg)}}',
    // safe area。两个来源合成一个变量:
    //   --safe-area-inset-* 是 Capacitor 8 的 SystemBars 插件在 Android 上注入的,
    //     值的含义就是「页面还需要自己让开多少」—— 原生已经让开时它是 0。
    //   env(safe-area-inset-*) 是 iOS(以及 Android 透传模式)那条路,
    //     前提是 viewport 里有 viewport-fit=cover,否则恒为 0。
    // 两边都没有就是 0,所以这几个变量在任何情况下都能直接用。
    '.in-app{',
    '--app-safe-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));',
    '--app-safe-right:var(--safe-area-inset-right,env(safe-area-inset-right,0px));',
    '--app-safe-bottom:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px));',
    '--app-safe-left:var(--safe-area-inset-left,env(safe-area-inset-left,0px));}',
    // 给网站用的工具类。网站自己的选择器可能更具体,不生效就自己写 var(--app-safe-*)
    '.in-app .app-safe-top{padding-top:var(--app-safe-top);}',
    '.in-app .app-safe-bottom{padding-bottom:var(--app-safe-bottom);}',
    '.in-app .app-safe-x{padding-left:var(--app-safe-left);padding-right:var(--app-safe-right);}',
    '.in-app .app-safe-inset{padding:var(--app-safe-top) var(--app-safe-right) ',
    'var(--app-safe-bottom) var(--app-safe-left);}',
    // 固定在顶部/底部的元素:把 inset 加到自身 padding 上,别改 top/bottom
    '.in-app .app-safe-fixed-top{top:0;padding-top:var(--app-safe-top);}',
    '.in-app .app-safe-fixed-bottom{bottom:0;padding-bottom:var(--app-safe-bottom);}',
  ].join('');
  document.head.appendChild(style);

  // ---------- 提示条 ----------
  var toastEl = null, toastTimer = null;
  function toast(text, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'app-shell-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2000);
  }

  // ---------- 1. 收起启动页 ----------
  function hideSplash() {
    setTimeout(function () { call('SplashScreen', 'hide', { fadeOutDuration: 200 }); },
      CONFIG.hideSplashDelay);
  }
  if (document.readyState === 'complete') hideSplash();
  else window.addEventListener('load', hideSplash, { once: true });
  // 网站卡住也别一直停在 splash
  setTimeout(hideSplash, 4000);

  // ---------- 2. 返回键 ----------
  if (CONFIG.backButton) {
    var lastBack = 0;
    listen('App', 'backButton', function (info) {
      var canGoBack = info && typeof info.canGoBack === 'boolean'
        ? info.canGoBack
        : window.history.length > 1;

      // 有弹层/抽屉打开时,交给网站自己关 —— 网站可以监听这个事件并 preventDefault
      var ev = new CustomEvent('appshell:back', { cancelable: true });
      if (!document.dispatchEvent(ev)) return;

      if (canGoBack) {
        window.history.back();
        return;
      }
      if (CONFIG.doubleTapToExit) {
        var now = Date.now();
        if (now - lastBack < 2000) { call('App', 'exitApp', {}); }
        else { lastBack = now; toast(CONFIG.exitHintText); }
      } else {
        call('App', 'exitApp', {});
      }
    });
  }

  // ---------- 3. 下拉刷新 ----------
  if (CONFIG.pullToRefresh) {
    var ptr = document.createElement('div');
    ptr.id = 'app-shell-ptr';
    ptr.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><path d="M21 3v6h-6"/></svg>';
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(ptr); });
    if (document.body) document.body.appendChild(ptr);

    var THRESHOLD = 70, MAX = 110;
    var startY = 0, startX = 0, pulling = false, armed = false;

    function scrollTop() {
      return window.pageYOffset || root.scrollTop || document.body.scrollTop || 0;
    }
    // 手指底下是不是一个自己能滚的容器(比如侧边栏、模态框里的列表)
    function insideScrollable(el) {
      for (var n = el; n && n !== document.body && n !== root; n = n.parentElement) {
        if (n.scrollTop > 0) return true;
        var oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) {
          if (n.scrollTop > 0) return true;
        }
      }
      return false;
    }

    window.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { armed = false; return; }
      var t = e.touches[0];
      startY = t.clientY; startX = t.clientX;
      var tag = (e.target.tagName || '').toLowerCase();
      armed = scrollTop() <= 0 &&
              tag !== 'input' && tag !== 'textarea' && tag !== 'select' &&
              !e.target.isContentEditable &&
              !insideScrollable(e.target);
      pulling = false;
    }, { passive: true });

    window.addEventListener('touchmove', function (e) {
      if (!armed || e.touches.length !== 1) return;
      var t = e.touches[0];
      var dy = t.clientY - startY;
      var dx = Math.abs(t.clientX - startX);
      if (dy <= 0 || dx > Math.abs(dy)) { // 往上滑或横向滑 —— 不是下拉
        if (pulling) { ptr.style.opacity = 0; pulling = false; }
        return;
      }
      if (scrollTop() > 0) { armed = false; return; }
      pulling = true;
      var d = Math.min(dy * 0.5, MAX);
      ptr.style.opacity = Math.min(d / THRESHOLD, 1);
      ptr.style.transform = 'translateY(' + d + 'px) rotate(' + d * 2.6 + 'deg)';
    }, { passive: true });

    window.addEventListener('touchend', function (e) {
      if (!pulling) return;
      pulling = false;
      var dy = (e.changedTouches && e.changedTouches[0].clientY - startY) || 0;
      if (dy * 0.5 >= THRESHOLD) {
        ptr.classList.add('spin');
        ptr.style.opacity = 1;
        ptr.style.transform = 'translateY(' + THRESHOLD + 'px)';
        setTimeout(function () { window.location.reload(); }, 120);
      } else {
        ptr.style.opacity = 0;
        ptr.style.transform = 'translateY(0)';
      }
    }, { passive: true });
  }

  // ---------- 4. 网络状态 ----------
  (function () {
    var wasOffline = false;
    function offline() {
      if (wasOffline) return;
      wasOffline = true;
      root.classList.add('in-app-offline');
      toast(CONFIG.offlineText, 3000);
    }
    function online() {
      if (!wasOffline) return;
      wasOffline = false;
      root.classList.remove('in-app-offline');
      toast(CONFIG.onlineText, 1600);
    }
    listen('Network', 'networkStatusChange', function (s) {
      if (s && s.connected === false) offline(); else online();
    });
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
  })();

  // ---------- 4.5 safe area ----------
  (function () {
    if (CONFIG.safeArea === 'cover') ensureViewportFitCover();

    function ensureViewportFitCover() {
      var metas = document.querySelectorAll('meta[name=viewport]');
      // SystemBars 插件也是看最后一个 meta viewport,这里保持一致
      var meta = metas.length ? metas[metas.length - 1] : null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'viewport');
        meta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
        document.head.appendChild(meta);
        return;
      }
      var content = meta.getAttribute('content') || '';
      if (/viewport-fit\s*=\s*cover/i.test(content)) return;
      content = content.replace(/\s*,?\s*viewport-fit\s*=\s*[a-z-]+/i, '').replace(/\s*,\s*$/, '');
      meta.setAttribute('content', (content ? content + ', ' : '') + 'viewport-fit=cover');
    }
  })();

  // 读出 safe area 的真实像素值。自定义属性用 getPropertyValue 读到的是没解析的
  // var()/env() 字面量,所以拿一个隐藏元素把它们当 padding 算一遍再读。
  function safeArea() {
    var probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:var(--app-safe-top);padding-right:var(--app-safe-right);' +
      'padding-bottom:var(--app-safe-bottom);padding-left:var(--app-safe-left);';
    (document.body || root).appendChild(probe);
    var cs = getComputedStyle(probe);
    var out = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    probe.remove();
    return out;
  }

  // ---------- 5. 外链 ----------
  (function () {
    function isDownloadLink(a, url) {
      if (a.hasAttribute('download')) return true;
      try { return CONFIG.downloadExtensions.test(url.pathname); } catch (err) { return false; }
    }
    function openExternal(href) {
      if (CONFIG.externalInAppBrowser) {
        call('Browser', 'open', { url: href, presentationStyle: 'popover' });
      } else {
        call('App', 'openUrl', { url: href });
      }
    }
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var raw = a.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#' || /^javascript:/i.test(raw)) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // tel:/mailto: 交给系统

      // ----- 下载链接 -----
      // 安卓不在这里拦:原生 WebView.setDownloadListener 会接住,交给系统
      // DownloadManager(通知栏进度 + 断点续传),比这里能做的好得多。
      //
      // iOS 只能走这条路:navigationDelegate 被 Capacitor 的 WebViewDelegationHandler
      // 占着且是 private(set),拿不到 WKDownloadDelegate,所以把链接交给
      // Safari View Controller,用户在那里能「存到文件」或分享到别的 app。
      //
      // 注意:Safari View Controller 不共享 WebView 的 cookie,所以需要登录才能
      // 下载的文件在 iOS 上会失败(下到登录页)。要支持就得让后端给下载链接发一个
      // 带签名的短期 URL(?t=<signed>),这个改动在服务器端,比跟 Capacitor 的
      // delegate 搏斗划算得多。
      if (CONFIG.interceptDownloadsOnIOS && platform === 'ios' && isDownloadLink(a, url)) {
        e.preventDefault();
        call('Browser', 'open', { url: url.href });
        return;
      }

      // 跨域链接 Capacitor 原生层已经会丢给系统浏览器,这里只补 target=_blank
      if (isSameSite(url.hostname) && a.target === '_blank') {
        e.preventDefault();
        window.location.href = url.href; // 同站的新窗口 —— 直接在 app 里打开
      } else if (!isSameSite(url.hostname)) {
        e.preventDefault();
        openExternal(url.href);
      }
    }, true);
  })();

  // ---------- 6. 深度链接 ----------
  (function () {
    // 原生两端发这个事件都带 retainUntilConsumed,所以冷启动时事件会一直留着,
    // 等这个监听注册上再送过来 —— 不用额外查 App.getLaunchUrl()。
    //
    // 代价:server.url 模式下冷启动会先加载网站首页,这个监听再把页面跳到目标 URL,
    // 也就是两次加载。想避免就得在原生侧把 URL 存下来当初始 URL,成本大得多。
    listen('App', 'appUrlOpen', function (ev) {
      var raw = ev && ev.url;
      if (!raw) return;
      var url;
      try { url = new URL(raw, location.href); } catch (e) { return; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (!isSameSite(url.hostname)) return;      // 不是自己的站,不跳
      if (url.href === location.href) return;     // 已经在这一页了
      window.location.href = url.href;
    });
  })();

  // ---------- 7. 离线缓存 ----------
  // 只在 app 里注册。app 的 WebView 有自己独立的存储,和用户浏览器里的注册
  // 互不干扰,所以线上站不会被这个 SW 影响 —— 这是刻意的选择,
  // 一个写坏的 SW 能把整个线上站搞挂。
  //
  // 缓存策略和"为什么 HTML 必须网络优先"写在 sw.js 的文件头里,改之前先看那段。
  var offline = {
    register: function () {
      if (!('serviceWorker' in navigator)) return Promise.resolve(null);
      return navigator.serviceWorker.register(CONFIG.serviceWorkerUrl, { scope: '/' }).catch(
        function (e) {
          // 最常见的原因:sw.js 不在网站根目录,或者服务器给它的
          // Content-Type 不是 JavaScript
          console.warn('[app-shell] Service Worker 注册失败', e);
          return null;
        },
      );
    },
    /** 清掉所有缓存并注销。排查"页面不更新"时用 */
    clear: function () {
      if (!('serviceWorker' in navigator)) return Promise.resolve(false);
      return navigator.serviceWorker.ready
        .then(function (reg) {
          if (reg.active) reg.active.postMessage({ type: 'clear-cache' });
          return reg.unregister();
        })
        .catch(function () { return false; });
    },
  };

  if (CONFIG.offlineCache) {
    // 等页面加载完再注册,别和首屏抢带宽
    if (document.readyState === 'complete') offline.register();
    else window.addEventListener('load', function () { offline.register(); }, { once: true });
  }

  // 给网站用:window.AppShell.toast('...') 之类
  window.AppShell = {
    platform: platform,
    toast: toast,
    call: call,
    safeArea: safeArea,
    isSameSite: isSameSite,   // app-push.js 用它拦住推送里的站外 url
    offline: offline,
    share: function (opts) { return call('Share', 'share', opts || {}); },
    exit: function () { return call('App', 'exitApp', {}); },
  };
})();
