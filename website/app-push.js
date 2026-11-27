/*!
 * app-push.js —— 推送通知的网站侧
 *
 * 依赖 app-shell.js,必须在它之后加载:
 *     <script src="/app-shell.js" defer></script>
 *     <script src="/app-push.js" defer></script>
 *
 * 在普通浏览器里什么都不做(第一个判断就 return 了)。
 *
 * 它负责这几段:
 *   1. 给已经授权过的用户静默重新注册 —— token 会变(重装、清数据),要拿到新的
 *   2. 把 token POST 到你的服务器,和当前登录用户绑定
 *   3. 点通知跳到 payload 里的 url(含 app 被完全杀掉的情况)
 *   4. 前台收到推送时弹个提示 —— 前台消息系统不会自己显示通知
 *
 * 它刻意不做的事:自己弹权限请求。iOS 用户拒绝一次就很难再要回来,
 * 所以要由网站在"用户做了某个表明他想要通知的动作"之后调:
 *
 *     AppShell.push.register().then(function (ok) {
 *       if (ok) AppShell.toast('已开启通知');
 *     });
 *
 * 典型时机:下单成功、点了"关注"、在设置页点了通知开关。
 * 不要在页面加载时调。
 */
(function () {
  'use strict';

  // ===================== 可调项 =====================
  var CONFIG = {
    // 接收 token 的接口。要能从会话里认出当前用户(所以带 credentials)
    tokenEndpoint: '/api/push-token',
    // 已经授权过就静默 register 一次,拿当前 token。不会弹任何东西
    autoRegisterIfGranted: true,
    // 前台收到推送时弹提示条
    toastOnForeground: true,
  };
  // =================================================

  var AppShell = window.AppShell;
  var Cap = window.Capacitor;
  if (!AppShell || !Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;

  var call = AppShell.call;

  // 用 AppShell.listen 而不是直接 Cap.addListener —— 前者扛得住 Capacitor 在
  // 页面导航时的 reset(见 app-shell.js 里「原生事件监听」那一节)。
  // 直接注册的话,后退过一次之后点推送通知就不会跳转了。
  // 老版本 app-shell.js 没有 listen,退回到直接注册。
  function listen(event, cb) {
    if (AppShell.listen) {
      AppShell.listen('PushNotifications', event, cb);
      return;
    }
    try {
      if (Cap.addListener) Cap.addListener('PushNotifications', event, cb);
    } catch (e) { /* 插件不可用就算了 */ }
  }

  // ---------- 监听:一定要在 register() 之前挂上 ----------
  // iOS 的 registration 事件没有 retainUntilConsumed(核对过 8.x 源码),
  // 挂晚了 token 就拿不到了。actionPerformed 两端都是 retain 的,所以
  // app 完全没启动时点通知,事件会留着等这里注册上再送过来。

  listen('registration', function (t) {
    if (t && t.value) postToken(t.value);
  });

  listen('registrationError', function (err) {
    // 最常见的原因:Android 少了 google-services.json,或者 iOS 的 App ID
    // 没开 Push Notifications / APNs key 没上传到 Firebase
    console.warn('[app-push] 注册推送失败', err);
  });

  listen('pushNotificationActionPerformed', function (action) {
    var url = action && action.notification && action.notification.data
      ? action.notification.data.url
      : null;
    if (!url) return;
    var target;
    try { target = new URL(url, location.href); } catch (e) { return; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
    // 只跳自己的站 —— 推送内容是从服务器来的,别让它把用户带到任意站点
    if (AppShell.isSameSite && !AppShell.isSameSite(target.hostname)) return;
    if (target.href === location.href) return;
    window.location.href = target.href;
  });

  if (CONFIG.toastOnForeground) {
    listen('pushNotificationReceived', function (n) {
      // 前台收到的消息系统不会自己显示通知,所以这里补一个
      var text = n && (n.title || n.body);
      if (text) AppShell.toast(text, 3000);
    });
  }

  // ---------- token 上报 ----------
  function postToken(value) {
    try {
      return fetch(CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',   // 要带会话,服务器才知道是哪个用户
        body: JSON.stringify({ token: value, platform: AppShell.platform }),
      }).catch(function (e) {
        console.warn('[app-push] token 上报失败', e);
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ---------- 对外 API ----------
  function check() {
    return call('PushNotifications', 'checkPermissions');
  }

  /** 请求权限并注册。返回 Promise<boolean> —— true 表示拿到授权了 */
  function register() {
    return call('PushNotifications', 'requestPermissions').then(function (perm) {
      if (!perm || perm.receive !== 'granted') return false;
      return call('PushNotifications', 'register').then(function () { return true; });
    });
  }

  // 已经授权过的用户:静默 register,拿当前 token。
  // 这一步不会弹任何界面,但重装/清数据之后的新 token 要靠它上报。
  if (CONFIG.autoRegisterIfGranted) {
    check().then(function (perm) {
      if (perm && perm.receive === 'granted') call('PushNotifications', 'register');
    });
  }

  AppShell.push = {
    register: register,
    check: check,
    sendToken: postToken,
    config: CONFIG,
  };
})();
