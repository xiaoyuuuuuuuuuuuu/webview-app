import type { CapacitorConfig } from '@capacitor/cli';
// Node 22+ 的 ESM loader 要求 JSON 导入带 import attribute,不加会让 `cap sync`
// 解析 capacitor.config.ts 时报 ERR_IMPORT_ATTRIBUTE_MISSING。
import appConfig from './app.config.json' with { type: 'json' };

const siteHost = new URL(appConfig.siteUrl).host;

// 只有这些 host 允许在 app 内部的 WebView 里打开。
// 其他任何链接(外部网站、广告、第三方登录页) Capacitor 会自动丢给系统浏览器。
// 这个列表越短越安全 —— 详见 README 的「安全」一节。
const allowNavigation = [
  siteHost,
  `*.${siteHost.replace(/^www\./, '')}`,
  ...appConfig.extraAllowedHosts,
];

const config: CapacitorConfig = {
  appId: appConfig.appId,
  appName: appConfig.appName,
  webDir: 'www',

  // 追加到 WebView User-Agent 末尾。空字符串时【整个键都不出现】——
  // Capacitor 看到空串也会照样拼一个空格上去,不如干脆不设。
  // 两端都生效(Capacitor 的顶层 appendUserAgent)。
  ...(appConfig.appendUserAgent ? { appendUserAgent: appConfig.appendUserAgent } : {}),

  server: {
    // 直接加载线上网站。网站内容一改 app 里立刻就变,不用重新上架。
    url: appConfig.siteUrl,
    cleartext: false,          // 只允许 https,不允许明文 http
    androidScheme: 'https',
    allowNavigation,
    // 主框架加载失败(断网、服务器挂了)时显示的本地页面。
    // Capacitor 原生内置,Android 和 iOS 都走这个 —— 不用写原生代码。
    errorPath: 'offline.html',
  },

  android: {
    allowMixedContent: false,  // 不允许 https 页面里加载 http 资源
    captureInput: true,
    // 这里【刻意不设】 webContentsDebuggingEnabled。
    //
    // Capacitor 的默认值就是"这个包可调试吗"(CapConfig.java:286,
    // 默认取 ApplicationInfo.FLAG_DEBUGGABLE),也就是:
    //   debug 包   → 远程调试开着,chrome://inspect 连得上
    //   release 包 → 关着
    // 这正是我们想要的。
    //
    // 以前这里写死 false,看着像"更安全",实际效果是把 debug 包的调试口也堵死了 ——
    // 真机排查时连 console 都看不到,而 release 包本来就不会开。
    // 只要这个键【出现在配置里】,显式值就会盖掉那个按构建类型的默认值,
    // 所以要恢复"按构建类型自动"就必须把这一行整个删掉,不能写 true/false。
  },

  ios: {
    // SPM 而不是 CocoaPods —— 云端构建不用装 CocoaPods,少一个坑
    packageManager: 'SPM',
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: appConfig.splashBackground,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      spinnerColor: appConfig.themeColor,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // 'light' = 浅色背景用的样式(深色图标),'dark' 反过来,'auto' = 跟系统深浅色。
      // iOS 用这个值。Android 上 SystemBars 会盖掉它,真正生效的是 MainActivity
      // 按 R.bool.statusBarDarkIcons 补设的那次(auto 在 Android 上按 themeColor 算)。
      style: appConfig.statusBarStyle === 'light' ? 'LIGHT' : appConfig.statusBarStyle === 'dark' ? 'DARK' : 'DEFAULT',
      backgroundColor: appConfig.themeColor,
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      // 不配这一项的话,插件兜底用 android.R.drawable.ic_dialog_info ——
      // 系统那个蓝色感叹号,在状态栏里看着像出错了。实测读的是
      // LocalNotificationManager.getDefaultSmallIcon()。
      //
      // 通知小图标必须是【纯白剪影 + 透明背景】,系统只取 alpha 通道然后自己上色;
      // 直接拿 app 图标当小图标会变成一个白方块。所以这里用一个单独的矢量图
      // res/drawable/ic_stat_notify.xml(一个铃铛),换成你自己的标志剪影更好。
      smallIcon: 'ic_stat_notify',
      iconColor: appConfig.themeColor,
    },
    // Capacitor 8 自带的 SystemBars 插件(@capacitor/android 核心,自动注册)负责
    // Android 的 edge-to-edge:它在 decorView 上挂 OnApplyWindowInsetsListener,
    // 并且永远往页面注入 --safe-area-inset-* 四个 CSS 变量。
    //
    // 它有两种模式,由页面 viewport 里有没有 viewport-fit=cover 决定:
    //   没有  → 原生把 WebView 让开系统栏,注入的变量是 0(网站什么都不用做)
    //   有    → 把 inset 透传给页面,注入真实值,网站 CSS 必须自己让开
    // 下面这个 hint 只是提前告诉它结果,避免首屏抖一下。
    SystemBars: {
      initialViewportFitValueHint: appConfig.safeArea === 'cover' ? 'cover' : '',
    },
  },
};

export default config;
