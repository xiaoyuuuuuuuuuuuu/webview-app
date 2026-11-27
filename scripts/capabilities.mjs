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
 * 四个字段的分工:
 *   ios         —— 要往 Info.plist 写的用途字符串
 *   android     —— 要往 AndroidManifest 加的权限
 *   androidMeta —— 要往 <application> 里加的 <meta-data>
 *   nativeMethods —— 我们【真的会通过 invoke() 调】的原生方法名。
 *                 verify 会拿它和插件 Android 源码里的 @PluginMethod 对一遍。
 *                 为什么要这条:invoke() 直接打原生 bridge,绕过插件的 JS 包装层。
 *                 包装层里有的方法,原生侧不一定有同名的 —— biometric 就踩过:
 *                 JS 层叫 authenticate(),原生层其实叫 internalAuthenticate。
 *                 【调错名字不会报错,会静默挂死】,Promise 永远不 settle。
 *   shellApi    —— 这个能力在 website/app-capabilities.js 里对应的 AppShell 成员。
 *                 verify 用它检查「开关开了但网站侧没接口」—— 扫码那次就差这一条:
 *                 开关、权限、插件全对,网站却没有能调的东西,而且没人会发现。
 *   androidRemove —— 【要从合并后的 Manifest 里【撤掉】的权限】。插件自己的库 manifest
 *                 声明的权限,Gradle 会无条件合并进 app,我们的开关管不到它。要撤只能
 *                 用 tools:node="remove"。目前只有 local-notifications 需要,原因见那一项。
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
  //
  // ⚠ 连带影响:NSCameraUsageDescription 挂在这一项上,所以关掉扫码之后
  //   iOS 上【网页里的「拍照上传」会崩】(缺用途字符串碰相机 = crash,不是报错)。
  //   Android 不受影响(没声明 CAMERA 时 Capacitor 走系统相机 intent,反而更顺)。
  //   这是有意识的取舍,不是遗漏 —— 详见 README 的「已知缺口:iOS 上的拍照上传」。
  //   站上一旦有上传图片的入口,把下面的 cameraUpload 开关打开就行,不用开回扫码。
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
    // 注意:本项目关着扫码,所以 app-capabilities.js 里【没有】scan()。
    // 要重新打开,除了开关和插件,还得从 commit 3634166 把 scan() 取回来 ——
    // 不取回的话 verify 的「网站侧有接口」这一条会直接报出来。
    shellApi: ['scan'],
  },

  // 网页里的「拍照上传」:<input type="file" accept="image/*"> 选「拍照」那一项。
  //
  // 【不装插件】。这条路 Capacitor 原生已经实现了(BUILD_SPEC 0.2:onShowFileChooser
  // 含 capture 属性和相机直拍),这个开关只补 iOS 缺的那一条用途字符串 ——
  // iOS 上缺 NSCameraUsageDescription 时一碰相机就是 crash,不是报错。
  //
  // Android 留空是故意的:实测 Capacitor 的 isMediaCaptureSupported() 在没声明
  // CAMERA 时返回 true,走系统相机 app 的 intent,不需要自己的权限,反而更顺
  // (BridgeWebChromeClient.java:307-313)。声明了 CAMERA 反而要多一次运行时授权。
  //
  // 默认关:测试站没有上传图片的入口,声明一个用不到的相机权限,审核会追问。
  // 真站上一旦出现上传图片的地方(头像、评价晒图、退货凭证、客服发图)就打开。
  //
  // plugin / npm 为 null:verify 里所有"插件名对不对、插件装没装、网站侧有没有接口"
  // 的检查都会跳过它,只检查用途字符串和开关是否一致。
  // 和 scanner 共用 NSCameraUsageDescription:两个都开时 configure 只写一条(先到先得)。
  cameraUpload: {
    plugin: null,
    npm: null,
    ios: {
      NSCameraUsageDescription: '拍照上传图片(比如评价晒图、退货凭证)时需要使用相机。',
    },
    android: [],
  },
  // 网页自己的定位:navigator.geolocation(附近门店、送货地址自动填写)。
  //
  // 【不装插件】。Capacitor 原生已经把网页的定位请求桥接到了系统权限
  // (BridgeWebChromeClient.onGeolocationPermissionsShowPrompt,会在运行时请求
  // ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION)。但桥接的前提是权限已经声明:
  // 没声明的权限一请求就被系统直接拒绝,连对话框都不弹 —— 网站只收到 PERMISSION_DENIED。
  // iOS 同理,没有 NSLocationWhenInUseUsageDescription 定位请求不会成功。
  // BUILD_SPEC 1.3 说"定位用 navigator.geolocation 就行",只对了一半,缺的就是这个开关。
  //
  // Android 两个都要声明:Capacitor 两个一起请求。Android 12+ 只给大概位置也算成功,
  // 但 11 及以下必须两个都给才算 —— 只声明 COARSE 的话老手机上永远是拒绝。
  //
  // 默认关:声明了定位,Google Play 的 Data safety 要多填一条,App Store 审核会问用途。
  // 网站真的用到定位再开。
  webLocation: {
    plugin: null,
    npm: null,
    ios: {
      NSLocationWhenInUseUsageDescription: '查找附近的门店、自动填写送货地址时需要使用你的位置。',
    },
    android: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'],
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
    shellApi: ['biometric'],
    // ⚠ 是 internalAuthenticate,不是 authenticate。原因见文件头的 nativeMethods。
    nativeMethods: ['checkBiometry', 'internalAuthenticate'],
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
    shellApi: ['saveImage'],
    nativeMethods: ['getAlbums', 'createAlbum', 'savePhoto'],
  },

  localNotifications: {
    plugin: 'LocalNotifications',
    npm: '@capacitor/local-notifications',
    // iOS 不需要用途字符串 —— 通知权限是运行时问的,不走 Info.plist。
    ios: {},
    // POST_NOTIFICATIONS 已经为了下载进度通知写进 Manifest 了,这里不用再加。
    android: [],
    androidMeta: [],
    // ⚠ 这个插件【自己的库 manifest】声明了四个权限,Gradle 合并进 app,开关管不到:
    //     POST_NOTIFICATIONS     —— 我们本来就有
    //     RECEIVE_BOOT_COMPLETED —— 重启后恢复已排期的通知,普通权限,留着
    //     WAKE_LOCK              —— 同上,普通权限,留着
    //     SCHEDULE_EXACT_ALARM   —— 必须撤掉,见下
    //
    // SCHEDULE_EXACT_ALARM 为什么必须撤:Android 官方文档写得很直接 —— 不符合政策的 app
    // 【没法带着这个权限发版】(要有闹钟/日历那种以精确定时为核心功能的场景才算符合)。
    // 一个商城 app 不符合。而且 Android 14+ 它默认就是拒绝的,留着也换不来精确定时。
    //
    // 撤掉安全吗?安全。插件的 setExactIfPossible() 先问 canScheduleExactAlarms(),
    // 不允许就退回 alarmManager.set()(非精确),只打一条 warn 日志,不抛异常 ——
    // 实测读的是 LocalNotificationManager.kt:350-375。购物车提醒这类场景差几分钟无所谓。
    // 另外 isExactNotification 默认是 true,所以网站侧调用时显式传 false,免得每次都刷警告。
    androidRemove: ['android.permission.SCHEDULE_EXACT_ALARM'],
    shellApi: ['notify', 'cancelNotify'],
    nativeMethods: ['checkPermissions', 'requestPermissions', 'schedule', 'cancel', 'createChannel'],
  },

  clipboard: {
    plugin: 'Clipboard',
    npm: '@capacitor/clipboard',
    // 写剪贴板不需要任何权限、任何用途字符串,两端都是。
    ios: {},
    android: [],
    androidMeta: [],
    // ⚠ 这个插件【有】read(),但 app-capabilities.js 【刻意只暴露写】。
    // 读剪贴板能拿到用户在别处复制的密码和验证码,是真的隐私风险;
    // 而且 iOS 会弹"xxx 粘贴自 yyy"的提示,体验也差。见 README 的「安全」一节。
    shellApi: ['copy'],
    nativeMethods: ['write'],
  },

  deviceId: {
    plugin: 'Device',
    npm: '@capacitor/device',
    ios: {},
    android: [],
    androidMeta: [],
    // ⚠ getId() 给的不是永久标识:Android 上卸载重装会变,iOS 上
    // identifierForVendor 在"同一厂商的 app 全部卸载后"也会变。
    // 别拿它当账号用,也别拿它做跨 app 追踪。要写进 Play 的 Data safety。
    shellApi: ['deviceId'],
    nativeMethods: ['getId'],
  },

  haptics: {
    plugin: 'Haptics',
    npm: '@capacitor/haptics',
    ios: {},
    // 插件自己的库 manifest 声明了 android.permission.VIBRATE,Gradle 会合并进来。
    // 这条【不用撤】:VIBRATE 是 normal 权限,安装时自动授予、不弹框,
    // Play 的 Data safety 也不用申报 —— 和 local-notifications 那个
    // SCHEDULE_EXACT_ALARM 完全不是一回事(那个会挡住发版)。
    // 这里不重复声明,交给 manifest 合并。
    android: [],
    androidMeta: [],
    shellApi: ['haptic'],
    nativeMethods: ['impact', 'notification', 'selectionChanged'],
  },

  inAppReview: {
    plugin: 'InAppReview',
    npm: '@capacitor-community/in-app-review',
    ios: {},
    android: [],
    androidMeta: [],
    // ⚠ 两端系统都有频率限制,所以"调了但什么都没弹"是正常结果,不是错误。
    // 代码不能因为没弹出来就报错或重试。
    shellApi: ['requestReview'],
    nativeMethods: ['requestReview'],
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
