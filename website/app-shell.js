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

  // 壳的版本号。网站侧可以用它判断「这个壳支不支持某个新接口」——
  // 用户手机里装的 app 可能比网站旧好几个版本,加了新接口就把这里 +1。
  var SHELL_VERSION = '1.1.0';

  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return; // 浏览器里直接退出

  var platform = Cap.getPlatform ? Cap.getPlatform() : 'unknown';
  var root = document.documentElement;
  root.classList.add('in-app', 'in-app-' + platform);

  // ---------- 调用约定 ----------
  // 两层:call() 宽松(失败一律 null,壳自己的功能都用它,不会让网站崩),
  //        invoke() 严格(失败 reject,而且带一个能判断的 code)。
  // 刻意不让 call() 走 invoke() 的能力检查 —— 收起启动页、返回键这些是
  // 已经在跑的功能,不给它们加新的失败路径。

  /** 最底层:直通 bridge,失败就 reject。没有能力检查。 */
  function nativeCall(plugin, method, options) {
    return new Promise(function (resolve, reject) {
      if (!Cap.nativePromise) {
        reject(shellError('nobridge', '原生 bridge 不可用(可能跳到了站外域名)'));
        return;
      }
      Cap.nativePromise(plugin, method, options || {}).then(resolve, reject);
    });
  }

  /** 宽松版:插件没装、调用失败都吞掉,返回 null。壳内部和老代码都用这个。 */
  function call(plugin, method, options) {
    return nativeCall(plugin, method, options).catch(function () { return null; });
  }

  /**
   * 严格版:失败会 reject,err.code 可以判断:
   *   'unsupported' —— 这个能力没编进 app(开关关着,或者用户装的是旧版壳)
   *   'nobridge'    —— 原生 bridge 不在(网站跳到了站外域名)
   *   'failed'      —— 插件自己报的错,原始错误在 err.cause 里
   *
   * 「用户拒绝权限」不算错误:权限接口会正常 resolve 出一个 denied 状态。
   * 所以网站能分清「没这个能力」和「有能力但用户不给权限」—— 这是 call() 办不到的,
   * 它把两种情况都变成了 null。
   */
  function invoke(plugin, method, options) {
    if (Cap.isPluginAvailable && !Cap.isPluginAvailable(plugin)) {
      return Promise.reject(shellError('unsupported', '这个 app 里没有 ' + plugin + ' 插件'));
    }
    return nativeCall(plugin, method, options).catch(function (e) {
      if (e && e.code === 'nobridge') throw e;
      throw shellError('failed', (e && e.message) || String(e), e);
    });
  }

  function shellError(code, message, cause) {
    var err = new Error(message);
    err.code = code;
    if (cause !== undefined) err.cause = cause;
    return err;
  }

  // ---------- 能力探测 ----------
  // 能力名 → 插件在 Capacitor 里注册的名字。
  // 【必须和 scripts/capabilities.mjs 里的 plugin 字段一致】。
  var CAPABILITY_PLUGIN = {
    // 由 app.config.json 的 capabilities 开关决定装不装
    scanner: 'BarcodeScanner',
    biometric: 'BiometricAuthNative',   // 实测的注册名,不是 BiometricAuth
    saveToAlbum: 'Media',
    localNotifications: 'LocalNotifications',
    // 壳一直都装的 7 个,列出来是为了 has() 对它们也能回答
    share: 'Share',
    browser: 'Browser',
    network: 'Network',
    push: 'PushNotifications',
    statusBar: 'StatusBar',
    splashScreen: 'SplashScreen',
    app: 'App',
  };

  /**
   * 一个能力到底在不在,问 Capacitor,不问配置文件。
   *
   * isPluginAvailable 最后查的是原生注入的 Capacitor.PluginHeaders ——
   * 也就是真的编进这台手机上这个 app 的插件列表。配置文件会和用户装的版本脱节
   * (网站更新了,用户的 app 还是老的),这个不会。
   */
  function has(name) {
    var plugin = CAPABILITY_PLUGIN[name];
    if (!plugin) return false;
    try {
      return !!(Cap.isPluginAvailable && Cap.isPluginAvailable(plugin));
    } catch (e) {
      return false;
    }
  }

  /** 一次拿到所有能力的开关状态,排查时很有用 */
  function capabilities() {
    var out = {};
    for (var name in CAPABILITY_PLUGIN) {
      if (Object.prototype.hasOwnProperty.call(CAPABILITY_PLUGIN, name)) out[name] = has(name);
    }
    return out;
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
    '#app-shell-toast{position:fixed;left:50%;',
    // 24px 是离底边的呼吸距离;--app-bottom-inset 是 app 自己的底部栏(Tab 栏)占的高度。
    // 不让开的话提示条会压在 Tab 栏上面 —— 它的 z-index 更高,会盖住 Tab 栏的图标。
    'bottom:calc(24px + var(--app-safe-bottom) + var(--app-bottom-inset, 0px));',
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
    '--app-safe-left:var(--safe-area-inset-left,env(safe-area-inset-left,0px));',
    // app 自己加在底部的栏占了多高(app-tabbar.js 建好 Tab 栏之后会把它设成栏高)。
    // 网站如果有自己的固定底栏,也可以设它,提示条会跟着让开。没有就是 0,等于没做。
    '--app-bottom-inset:0px;}',
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
    // 手指底下有没有一个【已经滚下去了】的容器(侧边栏、模态框里的列表)。
    //
    // 刻意只看 scrollTop:原来这里还查了一遍 overflowY 和 scrollHeight,但内层
    // 判断的仍然是 scrollTop > 0 —— 循环开头已经 return 过了,那一支永远进不去,
    // 等于每次 touchstart 都在祖先链上白跑一遍 getComputedStyle。
    //
    // 语义保持不变(只看 scrollTop)是有道理的:有些站是用内层 div 当主滚动容器的,
    // 那种站在容器顶部下拉应该能刷新;容器一旦滚下去了就不该再触发刷新。
    function insideScrollable(el) {
      for (var n = el; n && n !== document.body && n !== root; n = n.parentElement) {
        if (n.scrollTop > 0) return true;
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

  // 给网站用:window.AppShell.toast('...') 之类。
  // 接口清单见 README 的「AppShell 接口」一节 —— 改这里记得同步改那里和 SHELL_VERSION。
  window.AppShell = {
    version: SHELL_VERSION,
    platform: platform,
    toast: toast,
    call: call,
    invoke: invoke,
    has: has,
    capabilities: capabilities,
    safeArea: safeArea,
    isSameSite: isSameSite,   // app-push.js 用它拦住推送里的站外 url
    offline: offline,
    share: function (opts) { return call('Share', 'share', opts || {}); },
    exit: function () { return call('App', 'exitApp', {}); },
  };
})();
