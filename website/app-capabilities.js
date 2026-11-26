/*!
 * app-capabilities.js —— 原生能力的网站侧接口:生物识别、保存到相册、
 *                      本地通知、剪贴板(只写)、设备 ID、评分弹窗
 *
 * 依赖 app-shell.js,必须在它之后加载:
 *     <script src="/app-shell.js" defer></script>
 *     <script src="/app-capabilities.js" defer></script>
 *
 * 在普通浏览器里什么都不做(第一个判断就 return)。
 *
 * ───────────────────────────────────────────────────────────────────
 * 每一项都要 app.config.json 的 capabilities 开关打开【并且】插件已经
 * npm install,两者缺一不可:
 *   - 开关负责声明权限和 iOS 用途字符串(少了用途字符串,iOS 上是直接崩)
 *   - 插件负责真正的原生实现
 * `npm run verify` 会同时检查这两边,不一致会报出来。
 *
 * 全部走 AppShell.invoke(),所以失败有 err.code 可判断:
 *   'unsupported' —— 这个能力没编进 app(用户装的是旧版壳,或者根本没开)
 *   'denied'      —— 用户拒绝了权限(这是本文件自己加的 code)
 *   'nobridge'    —— 跳到了站外域名
 *   'failed'      —— 插件自己报的错,原始错误在 err.cause
 *
 * 【重要】每一个能力都要先 AppShell.has() 再调。用户手机里的 app 可能比
 * 网站旧好几个版本,网站不能假设新能力一定在。
 * ───────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ===================== 可调项 =====================
  var CONFIG = {
    // Android 保存图片必须指定相册,所以壳会按这个名字找/建一个。
    // iOS 不需要(不指定相册时走 add-only 权限,正好匹配我们声明的用途字符串)。
    albumName: 'My App',
    // 生物识别弹窗上的文案
    biometricReason: '验证身份后继续',
    biometricAndroidTitle: '身份验证',
    // 允许用设备密码/图案作为生物识别的回退
    allowDeviceCredential: true,

    // 本地通知的 Android 频道。插件自带的兜底频道名字就叫 "Default",
    // 用户在系统设置里看到的就是这个词 —— 很不体面,所以自己建一个。
    // 【改成你自己的业务分类】,比如「订单状态」「优惠提醒」。
    // 频道一旦建好,名字和重要性就不能再用代码改了(只有用户能改,或者换 id),
    // 所以想改名要连 id 一起换。iOS 没有频道这个概念,这一段会自动跳过。
    notifyChannel: {
      id: 'general',
      name: '通知',
      description: '订单状态和优惠提醒',
    },
  };
  // =================================================

  var AppShell = window.AppShell;
  if (!AppShell || !AppShell.invoke || !AppShell.has) return; // 浏览器里,或者壳太旧

  var invoke = AppShell.invoke;

  function capError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /** 统一的前置检查:能力在不在 */
  function requireCapability(name, pluginLabel) {
    if (!AppShell.has(name)) {
      return capError('unsupported', pluginLabel + ' 没有编进这个 app(capabilities.' + name + ' 没开,或者用户装的是旧版)');
    }
    return null;
  }

  // ---------------------------------------------------------------- 生物识别

  /** 这台设备能不能用生物识别。返回插件的原始结果,含 isAvailable / biometryType / reason */
  function biometryCheck() {
    var missing = requireCapability('biometric', '生物识别');
    if (missing) return Promise.reject(missing);
    return invoke('BiometricAuthNative', 'checkBiometry', {});
  }

  /**
   * 弹生物识别验证。成功 resolve true,用户取消或失败 reject。
   *
   * 【这不是登录】。它只证明"手机的主人在场",不证明身份 ——
   * 真正的登录态必须由服务器签发、绑设备、可吊销、有有效期。
   * 注入的脚本也能触发一次解锁,所以服务器侧必须二次校验。
   */
  function biometryVerify(options) {
    var missing = requireCapability('biometric', '生物识别');
    if (missing) return Promise.reject(missing);

    var opts = options || {};
    return biometryCheck().then(function (info) {
      if (info && info.isAvailable === false) {
        // reason 是插件给的原因(没录指纹、设备不支持、被锁定…),直接透出去更好排查
        throw capError('unsupported', '这台设备用不了生物识别:' + (info.reason || '未知原因'));
      }
      return invoke('BiometricAuthNative', 'authenticate', {
        reason: opts.reason || CONFIG.biometricReason,
        androidTitle: opts.androidTitle || CONFIG.biometricAndroidTitle,
        allowDeviceCredential:
          opts.allowDeviceCredential !== undefined ? opts.allowDeviceCredential : CONFIG.allowDeviceCredential,
        cancelTitle: opts.cancelTitle,
      }).then(function () {
        return true;
      });
    });
  }

  // ---------------------------------------------------------------- 保存到相册

  // Android 的 savePhoto 必须给 albumIdentifier,iOS 可以不给。
  // 所以 Android 上先按 CONFIG.albumName 找,找不到就建一个。
  function resolveAlbumIdentifier() {
    if (AppShell.platform !== 'android') return Promise.resolve(undefined);

    function findIn(result) {
      var albums = (result && result.albums) || [];
      for (var i = 0; i < albums.length; i++) {
        if (albums[i] && albums[i].name === CONFIG.albumName) return albums[i].identifier;
      }
      return null;
    }

    return invoke('Media', 'getAlbums', {}).then(function (r) {
      var found = findIn(r);
      if (found) return found;
      return invoke('Media', 'createAlbum', { name: CONFIG.albumName })
        .then(function () { return invoke('Media', 'getAlbums', {}); })
        .then(function (r2) {
          var made = findIn(r2);
          if (!made) throw capError('failed', '相册建好了但找不回它的 identifier');
          return made;
        });
    });
  }

  /**
   * 把一张图保存到相册。path 可以是网址、data: base64,或本地文件路径。
   * 典型用途:保存优惠券、订单二维码、商品图。
   */
  function saveImage(path, options) {
    var missing = requireCapability('saveToAlbum', '保存到相册');
    if (missing) return Promise.reject(missing);
    if (!path) return Promise.reject(capError('failed', 'saveImage 要一个图片地址'));

    var opts = options || {};
    return resolveAlbumIdentifier().then(function (albumIdentifier) {
      var payload = { path: path };
      if (albumIdentifier) payload.albumIdentifier = albumIdentifier;
      // fileName 只有 Android 认,而且不要带扩展名
      if (opts.fileName) payload.fileName = String(opts.fileName).replace(/\.[^.]+$/, '');
      return invoke('Media', 'savePhoto', payload);
    });
  }

  // ---------------------------------------------------------------- 本地通知

  // 通知 id 必须是 Java 的 int(32 位),所以不能直接用 Date.now()。
  // 从当前秒数取个起点,之后自增 —— 同一次运行里不会撞。
  var notifyId = Math.floor(Date.now() / 1000) % 1000000;
  function nextNotifyId() {
    notifyId = (notifyId + 1) % 2000000000;
    return notifyId;
  }

  var channelReady = null;
  /** Android 上懒建一次频道。失败不算错 —— 插件有兜底频道,通知照样能弹。 */
  function ensureChannel() {
    if (AppShell.platform !== 'android') return Promise.resolve(null);
    if (channelReady) return channelReady;
    channelReady = invoke('LocalNotifications', 'createChannel', {
      id: CONFIG.notifyChannel.id,
      name: CONFIG.notifyChannel.name,
      description: CONFIG.notifyChannel.description,
      importance: 3,   // IMPORTANCE_DEFAULT:有声音,不强插到屏幕上
    })
      .then(function () { return CONFIG.notifyChannel.id; })
      .catch(function () { return null; });   // 建不出来就用插件的兜底频道
    return channelReady;
  }

  /**
   * 弹一条本地通知。
   *
   *   notify({ title: '订单已发货', body: '点进来看物流' })            // 立刻弹
   *   notify({ title: '购物车还有东西', body: '...', at: someDate })   // 到点弹
   *
   * resolve 出这条通知的 id,可以拿去 cancelNotify(id)。
   * 传同一个 id 再调一次就是替换(典型用途:购物车提醒只保留最新一条)。
   *
   * 【这不是推送】。本地通知是这台手机自己排的,服务器发不了 ——
   * 服务器要主动找用户得走推送(app-push.js)。它的用处是「app 里发生了什么,
   * 过一会儿提醒用户回来」,不需要任何服务器。
   */
  function notify(options) {
    var missing = requireCapability('localNotifications', '本地通知');
    if (missing) return Promise.reject(missing);

    var opts = options || {};
    if (!opts.title && !opts.body) {
      return Promise.reject(capError('failed', 'notify 至少要有 title 或 body'));
    }

    var id = typeof opts.id === 'number' ? opts.id : nextNotifyId();

    return invoke('LocalNotifications', 'checkPermissions', {})
      .then(function (st) {
        // 已经拒过就别再问 —— 系统不会再弹,只会直接返回 denied
        if (st && st.display === 'granted') return st;
        return invoke('LocalNotifications', 'requestPermissions', {});
      })
      .then(function (st) {
        if (!st || st.display !== 'granted') {
          throw capError('denied', '用户没有允许通知');
        }
        return ensureChannel();
      })
      .then(function (channelId) {
        var note = {
          id: id,
          title: opts.title || '',
          body: opts.body || '',
          // 默认是 true,会要求精确闹钟。我们【刻意】撤掉了 SCHEDULE_EXACT_ALARM
          // (Google Play 不让不符合政策的 app 带着它发版,见 scripts/capabilities.mjs),
          // 所以这里显式传 false —— 不传的话插件每次都会刷一条 warn 日志。
          isExactNotification: false,
        };
        if (channelId) note.channelId = channelId;
        if (opts.at) {
          var when = opts.at instanceof Date ? opts.at : new Date(opts.at);
          if (isNaN(when.getTime())) throw capError('failed', 'notify 的 at 不是个有效时间');
          // 插件 Android 侧用 SimpleDateFormat 按 UTC 解析 toISOString() 的格式,
          // 已核对源码(LocalNotificationSchedule.kt:28-33),所以直接传 Date 就对。
          note.schedule = { at: when };
        }
        if (opts.extra) note.extra = opts.extra;
        return invoke('LocalNotifications', 'schedule', { notifications: [note] });
      })
      .then(function () { return id; });
  }

  /** 撤掉一条还没弹的通知(已经弹出来的不受影响)。id 不存在也不报错。 */
  function cancelNotify(id) {
    var missing = requireCapability('localNotifications', '本地通知');
    if (missing) return Promise.reject(missing);
    return invoke('LocalNotifications', 'cancel', { notifications: [{ id: id }] });
  }

  // ---------------------------------------------------------------- 剪贴板(只写)

  /**
   * 把文字复制到剪贴板。典型用途:复制订单号、优惠码、取货码。
   *
   * 【只有写,没有读】,这是刻意的。插件本身有 read(),但读剪贴板能拿到用户
   * 在别处复制的密码和验证码,是真的隐私风险 —— 而 WebView 里的 XSS 就能调它。
   * iOS 还会弹"xxx 粘贴自 yyy"的系统提示,体验也差。要读就让用户自己粘贴。
   */
  function copy(text) {
    var missing = requireCapability('clipboard', '剪贴板');
    if (missing) return Promise.reject(missing);
    if (text === undefined || text === null) {
      return Promise.reject(capError('failed', 'copy 要一段文字'));
    }
    return invoke('Clipboard', 'write', { string: String(text) }).then(function () { return true; });
  }

  // ---------------------------------------------------------------- 设备 ID

  /**
   * 这台设备的标识,resolve 出一个字符串。
   *
   * 【不是永久的,也不是账号】:Android 上卸载重装会变,iOS 上同一厂商的 app
   * 全部卸载后也会变。能用来做"这台设备的偏好设置""风控上的一个信号",
   * 不能用来替代登录,更不能用来做跨 app 追踪。
   * 用了它就要写进 Google Play 的 Data safety 表格。
   */
  function deviceId() {
    var missing = requireCapability('deviceId', '设备 ID');
    if (missing) return Promise.reject(missing);
    return invoke('Device', 'getId', {}).then(function (r) {
      var v = r && (r.identifier || r.uuid);
      if (!v) throw capError('failed', '插件没给出设备标识');
      return v;
    });
  }

  // ---------------------------------------------------------------- 评分弹窗

  /**
   * 请求系统弹应用内评分。resolve 出 true。
   *
   * 【"什么都没弹"是正常结果,不是错误】。两端系统都有频率限制
   * (iOS 一年最多 3 次,Android 也有自己的配额),而且 API 不告诉你弹没弹。
   * 所以:不要重试,不要因此提示用户,也不要据此判断用户评没评。
   *
   * 时机很重要:在用户刚完成一件顺利的事之后调(下单成功、收货确认),
   * 别在刚失败完一单、或者刚进 app 的时候调。
   */
  function requestReview() {
    var missing = requireCapability('inAppReview', '评分弹窗');
    if (missing) return Promise.reject(missing);
    return invoke('InAppReview', 'requestReview', {}).then(function () { return true; });
  }

  // ---------------------------------------------------------------- 对外

  AppShell.saveImage = saveImage;
  AppShell.biometric = {
    check: biometryCheck,
    verify: biometryVerify,
  };
  AppShell.notify = notify;
  AppShell.cancelNotify = cancelNotify;
  AppShell.copy = copy;
  AppShell.deviceId = deviceId;
  AppShell.requestReview = requestReview;
  AppShell.capabilitiesConfig = CONFIG;
})();
