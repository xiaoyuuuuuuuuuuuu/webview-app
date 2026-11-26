/*!
 * app-capabilities.js —— 原生能力的网站侧接口:生物识别、保存到相册
 *
 * 依赖 app-shell.js,必须在它之后加载:
 *     <script src="/app-shell.js" defer></script>
 *     <script src="/app-capabilities.js" defer></script>
 *
 * 在普通浏览器里什么都不做(第一个判断就 return)。
 *
 * ───────────────────────────────────────────────────────────────────
 * 这两项都要 app.config.json 的 capabilities 开关打开【并且】插件已经
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

  // ---------------------------------------------------------------- 对外

  AppShell.saveImage = saveImage;
  AppShell.biometric = {
    check: biometryCheck,
    verify: biometryVerify,
  };
  AppShell.capabilitiesConfig = CONFIG;
})();
