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
    webContentsDebuggingEnabled: false,  // 生产关闭远程调试
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
      style: appConfig.statusBarStyle === 'light' ? 'LIGHT' : 'DARK',
      backgroundColor: appConfig.themeColor,
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
