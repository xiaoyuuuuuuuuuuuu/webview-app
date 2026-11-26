/**
 * 原生能力登记表 —— configure.mjs 和 verify.mjs 共用的唯一来源。
 *
 * 这张表只描述「开一个能力，要声明哪些权限和用途字符串」。它【不装插件】：
 * 插件要自己 `npm install`，开关只负责权限声明和关掉时清干净。
 *
 * 为什么要能关干净:
 *   - Info.plist 里声明了用途字符串却没有对应功能,Apple 审核会追问这个权限干什么用
 *   - Android 多一个权限,Google Play 的 Data safety 表格就要多填一条
 *   - 这和 enablePushNotifications 关掉时必须清掉 entitlement 和 pbxproj 引用
 *     是同一个道理(那一处已经实测过两个方向都干净)
 *
 * 为什么默认全关:
 *   在 WebView 里 XSS 不再只是网页 bug —— 注入的脚本能调用所有已安装的原生插件。
 *   每开一个能力就是在扩大 XSS 的影响面,而这里几个恰好是摄像头、相册、生物识别
 *   这类高价值目标。见 BUILD_SPEC.md 第 1.3 节和 README 的「安全」一节。
 *
 * ⚠ `plugin` 是插件在 Capacitor 里注册的名字,网站侧 `AppShell.has()` 靠它判断
 *   这个能力到底有没有编进 app(走 Capacitor.isPluginAvailable,读的是原生注入的
 *   PluginHeaders,所以反映的是真实情况,不是配置文件说了什么)。
 *   【真正 npm install 插件的时候,核对一次它 registerPlugin 的名字】——
 *   名字写错的后果是 has() 永远返回 false,而且不会报错。
 */
export const CAPABILITIES = {
  // 本项目没开。它 iOS 上用不了(插件没 Package.swift,SPM 不收它),而且它一个人就让
  // Android debug APK 涨 9.2 MiB(实测:19,142,295 → 9,480,634 字节),因为插件把离线模型、
  // play-services-code-scanner 和 androidx.camera 全栈都拉进来。要开先读 README
  // 的「为什么没开扫码」—— 网站侧实现在 commit 3634166 里,可以取回。
  scanner: {
    plugin: 'BarcodeScanner',
    npm: '@capacitor-mlkit/barcode-scanning',
    ios: {
      NSCameraUsageDescription: '扫描商品条码和取货码时需要使用相机。',
    },
    android: ['android.permission.CAMERA'],
    // 让 Play Services 在安装 app 时就把 ML Kit 的扫码模块装好。
    // 不加这条就得在运行时调 installGoogleBarcodeScannerModule() 现下 ——
    // 零售场景常常在店里网不好,第一次扫码就失败。
    // 注意 meta-data 必须在 <application> 里面,所以它走和权限不同的注入点。
    androidMeta: [{ name: 'com.google.mlkit.vision.DEPENDENCIES', value: 'barcode_ui' }],
  },

  biometric: {
    // 注册名实测是 BiometricAuthNative(@CapacitorPlugin(name = "BiometricAuthNative")),
    // 不是包名暗示的 BiometricAuth。写错 has() 会永远返回 false 且不报错。
    plugin: 'BiometricAuthNative',
    // 注意:不要用 capacitor-native-biometric —— 它依赖 @capacitor/core ^3.4.3,
    // 最后一次发布是 2023-06,停在 Capacitor 3 时代。
    npm: '@aparajita/capacitor-biometric-auth',
    ios: {
      // 少了这一条,iOS 上调用面容 ID 是【直接崩】,不是返回错误。
      NSFaceIDUsageDescription: '用面容 ID 快速登录你的账号。',
    },
    android: [],
    androidMeta: [],
  },

  saveToAlbum: {
    plugin: 'Media',
    npm: '@capacitor-community/media',
    ios: {
      // 只写不读,所以用 Add 这个 key。NSPhotoLibraryUsageDescription 是读相册,
      // 声明了审核会多问一轮,而保存图片根本不需要读。
      NSPhotoLibraryAddUsageDescription: '把优惠券、订单二维码保存到你的相册。',
    },
    // 只存到 app 自己的相册不需要任何 Android 权限(插件 README 实测确认),
    // READ_MEDIA_IMAGES 那些只有"相册类 app 要读全部相册"才需要。
    android: [],
    androidMeta: [],
  },

  localNotifications: {
    plugin: 'LocalNotifications',
    npm: '@capacitor/local-notifications',
    ios: {},
    // POST_NOTIFICATIONS 已经为了下载进度通知写进 Manifest 了,这里不用再加。
    android: [],
    androidMeta: [],
  },
};

/** 配置里认识的开关名 */
export const CAPABILITY_NAMES = Object.keys(CAPABILITIES);

/** 读 app.config.json 的 capabilities,缺省当全关 */
export function enabledCapabilities(cfg) {
  const caps = (cfg && cfg.capabilities) || {};
  return CAPABILITY_NAMES.filter((name) => caps[name] === true);
}

/** 校验 capabilities 这一段,返回错误信息数组(空数组 = 没问题) */
export function validateCapabilities(cfg) {
  const errors = [];
  const caps = cfg && cfg.capabilities;
  if (caps === undefined) return errors; // 没写就是全关,合法
  if (typeof caps !== 'object' || caps === null || Array.isArray(caps)) {
    errors.push('capabilities 必须是一个对象,像 { "scanner": false }');
    return errors;
  }
  for (const [key, value] of Object.entries(caps)) {
    if (!CAPABILITIES[key]) {
      errors.push(`capabilities 里有不认识的开关 "${key}"(认识的:${CAPABILITY_NAMES.join('、')})`);
    } else if (typeof value !== 'boolean') {
      errors.push(`capabilities.${key} 必须是 true 或 false,现在是 ${JSON.stringify(value)}`);
    }
  }
  return errors;
}
