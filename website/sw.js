/*!
 * sw.js —— 离线缓存。放在网站【根目录】(/sw.js),否则拿不到 '/' 作用域。
 *
 * 这个文件只在 app 里注册(app-shell.js 判断 Capacitor.isNativePlatform()),
 * 普通浏览器访问网站时不会注册,所以不会影响你的线上站。
 * app 的 WebView 有自己独立的存储,和 Safari / Chrome 的注册互不干扰。
 *
 * ───────────────────────────────────────────────────────────────────
 * 为什么是"网络优先",不是"缓存优先" —— 这一条是读 Capacitor 源码定下来的,
 * 改之前务必看懂:
 *
 * Android 上 Capacitor 的原生 bridge 不是靠 WKUserScript 那种机制注入的,
 * 而是【代理 HTML 请求、把 bridge JS 内联插进 <head>】
 * (WebViewLocalServer.handleProxyRequest → JSInjector.getInjectedStream)。
 * 而且它只在请求的 Accept 头包含 text/html 时才走这条路。
 *
 * 由此有两条硬规则:
 *
 *   1. fetch 必须传【原始的 request 对象】,不能传 request.url。
 *      传 URL 会新建一个 Accept: * / * 的请求,Android 不注入 bridge,
 *      缓存下来的 HTML 里就没有 window.Capacitor —— 离线打开那页时
 *      app-shell.js 整个失效(下拉刷新、返回键、外链分流全没了)。
 *
 *   2. HTML 一律网络优先。电商站的价格和库存不能给缓存版本,
 *      缓存只在网络真的失败时兜底。
 *
 * iOS 不受第 1 条影响(那边 bridge 走 WKUserScript,每次都注入),
 * 但两端用同一套逻辑更好排查。
 * ───────────────────────────────────────────────────────────────────
 */

'use strict';

// 改了缓存策略就把版本号 +1,activate 时会清掉旧缓存
var VERSION = 'v1';
var HTML_CACHE = 'html-' + VERSION;
var ASSET_CACHE = 'asset-' + VERSION;

// 静态资源缓存条数上限,防止无限涨
var ASSET_LIMIT = 80;

// 这些路径一律不缓存。电商站把购物车、结算、接口缓存了会出真事故。
// 边界写成 (/|$|-|?) 是刻意的:/account-manager 这种也要挡住,
// 但 /apidocs 这种只是前缀撞上的不挡。
var NEVER_CACHE = /^\/(api|cart|checkout|account|login|logout|wp-admin|wp-login)(\/|$|-|\?)/i;

// 只缓存这些类型的静态资源
var ASSET_EXT = /\.(css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)$/i;

self.addEventListener('install', function () {
  // 不预缓存任何东西:这是个套壳现有网站的 SW,不知道站上有哪些关键资源。
  // 用户走到哪缓存到哪,反而不会缓存一堆用不上的东西。
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name !== HTML_CACHE && name !== ASSET_CACHE) return caches.delete(name);
            return null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// 网站或 app-shell.js 可以发消息过来清缓存
self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'clear-cache') return;
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) { return caches.delete(n); }));
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  // 只管自己站的 GET。跨域、POST、以及带 Range 的媒体请求都放过
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.headers.has('range')) return;

  var path = new URL(request.url).pathname;
  if (NEVER_CACHE.test(path)) return;

  if (isNavigation(request)) {
    event.respondWith(htmlNetworkFirst(request));
    return;
  }

  if (ASSET_EXT.test(path)) {
    event.respondWith(assetCacheFirst(request));
  }
  // 其它(比如 XHR 拿 JSON)不碰,交给网络
});

function isNavigation(request) {
  if (request.mode === 'navigate') return true;
  var accept = request.headers.get('accept') || '';
  return accept.indexOf('text/html') !== -1;
}

/**
 * HTML:网络优先,成功就顺手存一份,失败才用缓存。
 * 注意这里传的是 request 本身(见文件头第 1 条规则)。
 */
function htmlNetworkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.status === 200 && response.type === 'basic') {
        var copy = response.clone();
        caches.open(HTML_CACHE).then(function (cache) {
          // 只存没带查询串的页面:?page=2&sort=price 这种组合是无底洞
          if (!new URL(request.url).search) cache.put(request, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        return hit || offlineFallback();
      });
    });
}

/** 静态资源:缓存优先,后台顺手更新一次 */
function assetCacheFirst(request) {
  return caches.open(ASSET_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var network = fetch(request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone()).then(function () { trim(cache); });
          }
          return response;
        })
        .catch(function () {
          return hit || Response.error();
        });
      return hit || network;
    });
  });
}

function trim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= ASSET_LIMIT) return null;
    // 粗暴但够用:超了就从最早的开始删
    return Promise.all(keys.slice(0, keys.length - ASSET_LIMIT).map(function (k) {
      return cache.delete(k);
    }));
  });
}

/**
 * 离线且没有缓存时的兜底页。
 *
 * 为什么 SW 自己返回一个页面,而不是让 Capacitor 的 errorPath(offline.html)接管:
 * SW 一旦接管了导航请求,原生层就看不到"主框架加载失败"这件事,errorPath 不会触发。
 * 所以这里自己给一个,内容和 scripts/templates/offline.html 保持一致的意思。
 */
function offlineFallback() {
  var html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>离线</title><style>' +
    ':root{color-scheme:light dark}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;' +
    'background:#fff;color:#18181b;padding:24px;text-align:center}' +
    '@media(prefers-color-scheme:dark){body{background:#0f1216;color:#e7eaef}}' +
    'h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0 0 1.5rem;opacity:.7}' +
    'button{font:inherit;padding:.7em 1.6em;border:0;border-radius:999px;' +
    'background:#1565c0;color:#fff}' +
    '</style></head><body><div><h1>这一页还没缓存</h1>' +
    '<p>连上网络后可以继续浏览。已经看过的页面在离线时仍然可以打开。</p>' +
    '<button onclick="location.reload()">重新加载</button></div></body></html>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
