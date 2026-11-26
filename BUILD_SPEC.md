# WebView App 实施方案

把一个 cPanel 托管的网站包成 iOS / Android app。本文档是给实现者(人或 Claude Code)的完整规格。

**起点代码**:`webview-app.tar.gz`,Capacitor 8.6.2,Android + iOS 已生成,配置系统和云端构建已经跑通。

**本文档的作者无法编译验证**(没有 Mac,容器里装不了 Android SDK),所以第 0 部分的"已验证"只代表**配置一致性和源码层面验证过**,不代表真机跑过。**每一项实现完都必须真机验证**,见第 4 部分。

---

## 这份文档怎么用

1. 先读第 0 部分 —— 里面列了 Capacitor **已经内置**的功能。这是最重要的一节,因为
   webview 壳 80% 的"要做的功能"Capacitor 其实已经做了,重复实现会把事情搞砸
   (比如自己换掉 `WebViewClient` 会直接废掉原生 bridge)。
2. 第 1 部分是架构约束,改这些之前先想清楚。
3. 第 2 部分按 P0 → P1 → P2 顺序做。每做完一项,按该项的"验收"跑一遍。
4. 第 5 部分是已知坑,实现前扫一眼能省几个小时。

---

## 第 0 部分:现状盘点

### 0.1 已经做好的(代码在 tar.gz 里)

| 项 | 实现位置 | 状态 |
|---|---|---|
| 配置集中化 | `app.config.json` + `scripts/configure.mjs` | 改一个文件,同步到 Android/iOS 的 appId、包名、app 名、主题色、Java 包路径、Xcode scheme |
| 配置自检 | `scripts/verify.mjs` | 21 项一致性检查,`npm run verify` |
| 自定义离线页 | `scripts/templates/offline.html` → `server.errorPath` | 中文、深浅色自适应、自动重连 |
| 启动页 | `@capacitor/splash-screen` + `assets/splash*.png` | 配置好了,`app-shell.js` 负责收起 |
| 原生图标 | `assets/icon.png` + `npm run assets` | 占位图,**上架前必须换** |
| 下拉刷新 | `website/app-shell.js` | 纯 JS,已用 jsdom 测过 |
| 返回键 | `website/app-shell.js` + App 插件 | 有历史则后退,首页双击退出,网站可 `preventDefault` 拦截 |
| 外链分流 | `allowNavigation` + `app-shell.js` | 外站走系统浏览器,同站 `target=_blank` 留在 app |
| 断网提示条 | `website/app-shell.js` | Network 插件 + window 事件双保险 |
| Android 云构建 | `.github/workflows/android.yml` | debug APK 零配置;release AAB 需 4 个 secret |
| iOS 云构建 | `.github/workflows/ios.yml` | 无证书编译验证 + ASC API Key 自动签名上 TestFlight |
| Android 签名 | `android/app/build.gradle` | keystore 走环境变量,版本号走环境变量 |

已装插件(7 个,刻意保持最少 —— 见 1.3):
`app` `browser` `network` `splash-screen` `status-bar` `share` `push-notifications`

### 0.2 Capacitor 已经内置 —— 不要重复实现

这节是**读过 Capacitor 8.6.2 源码确认的**,附源码位置。实现前务必核对。

| 功能 | 已内置的实现 | 源码位置 |
|---|---|---|
| **文件上传** | `onShowFileChooser` 已实现,含 `accept`/`capture` 属性处理、相机直拍、相机权限请求、失败回退到文件选择器 | `@capacitor/android/.../BridgeWebChromeClient.java:276` |
| **网页权限请求** | `getUserMedia` 的相机/麦克风权限已桥接到原生权限 | 同上 `:102` |
| **离线兜底页** | `server.errorPath` 配了就自动在主框架加载失败时跳转。**Android 和 iOS 都支持** | Android `BridgeWebViewClient.java:45`;iOS `WebViewDelegationHandler.swift:145,156` |
| **返回键基础行为** | App 插件注册了 `OnBackPressedCallback`:没有 JS 监听时 `canGoBack()` 就 `goBack()` | `@capacitor/app/.../AppPlugin.java:46` |
| **外链丢给系统浏览器** | `shouldOverrideUrlLoading` → `bridge.launchIntent(url)`,按 `allowNavigation` 判断 | `BridgeWebViewClient.java:27` |
| **远程页面的原生 bridge** | `server.url` 模式下 `native-bridge.js` 会在页面脚本之前注入到 `appUrl` 的 origin,所以远程网站上能直接用 `Capacitor.nativePromise(...)` | `Bridge.java:267-270` |

**Android 特别注意**:不要为了加功能去 `bridge.setWebViewClient(new WebViewClient(){...})`。
Capacitor 的 `BridgeWebViewClient` 承载了 `shouldInterceptRequest`(本地资源服务)、
bridge 注入、错误页跳转。要扩展必须 `extends BridgeWebViewClient` 并在每个 override
里调 `super`。进度条那一项用的是 `WebChromeClient`,是另一个对象,相对安全。

**iOS 特别注意**:`WebViewDelegationHandler` 实现了几乎所有
`WKNavigationDelegate` / `WKUIDelegate` 方法(含 `target="_blank"` 的
`createWebViewWith`、`decidePolicyFor navigationAction`、JS alert/confirm/prompt),
而且它在 bridge 里是 `public private(set) var` —— **替换不了**。
扩展 iOS 只能走这三个官方钩子(都是 `open func`,见第 2 部分的表):
`webView(with:configuration:)`、`capacitorDidLoad()`、`webViewConfiguration(for:)`,
以及 KVO(不抢 delegate)。**没实现**的是
`decidePolicyFor navigationResponse` 和整个 `WKDownloadDelegate` ——
但要用上它们必须先拿到 navigationDelegate,所以实际上拿不到。这直接决定了
iOS 下载必须走另一条路,见第 3 部分。

### 0.3 待实现(本文档的正题)

| 优先级 | 功能 | 为什么 |
|---|---|---|
| **P0** | 页面加载进度条 | `server.url` 模式每次导航都要网络往返,没有进度指示体验很差,也最像"网页套壳" |
| **P0** | 文件下载 | WebView 不会自动下载,点下载链接完全没反应 |
| **P0** | Safe area 适配 | 刘海屏/灵动岛/底部手势条会压住网站内容 |
| **P1** | 推送通知完整链路 | 目前只装了插件。Firebase 配置、权限、token 上报、点击跳转全没做 |
| **P1** | 深度链接 | 点网站链接直接打开 app;也是上架加分项 |
| **P1** | 过审用的原生功能 | Apple 4.2 要求 app 必须比网站多做点什么 |
| **P2** | 离线缓存 | 让看过的页面离线可读 |
| **P2** | 应用内更新提示 | 强制用户升级到新版本 |

---

## 第 1 部分:架构约束

### 1.1 `server.url` 模式 —— 这是刻意的选择,不是疏忽

app 直接加载线上网站(`capacitor.config.ts` 的 `server.url`),不打包前端。

**Capacitor 官方文档明确说这个选项是给开发期 live-reload 用的,不是为生产设计的**,
Ionic 团队也确认过。代价是真实的:每次启动都从服务器拉全部内容、完全没网打不开、
原生层和网站版本对不上时排查绕。

但对"把现有 PHP/WordPress 网站变成 app"这个需求,这是唯一可行的架构 ——
服务器渲染的站没法打包进 `webDir`。WebViewGold 那类商业产品是一样的架构、一样的代价。

**不要为了"更正规"去改成 `webDir` 模式**,除非前端被重写成 SPA。

### 1.2 原生代码保持零修改(目前)

`android/` 和 `ios/` 目前**没有任何手工修改**,全是 `cap add` 生成的原样。
好处是 `npx cap migrate` 升级 Capacitor 不会冲突。

第 2 部分的 P0 项必须动原生代码。动的时候:

- **改动尽量集中在 `MainActivity.java` 和一个 iOS `ViewController` 子类里**,
  不要散到多个文件
- 每个改动文件顶部写一行注释说明为什么改,方便升级时判断
- 改完在 `README.md` 的「升级 Capacitor」一节补一句"有原生改动,升级后需要重新检查 X"

### 1.3 插件最小化是安全要求,不是洁癖

在 WebView 里 **XSS 不再只是网页 bug**:注入的脚本能调用所有已安装的原生插件
(文件系统、通讯录、相机、安全存储)。所以每装一个插件就是在扩大 XSS 的影响面。

当前**刻意没装** `@capacitor/filesystem`、`@capacitor/camera`、`@capacitor/geolocation`。

加插件前先问:这个功能能不能用网页 API 实现?(比如定位用 `navigator.geolocation`,
Capacitor 已经桥接了网页权限请求;拍照上传用 `<input type="file" capture>`,
`onShowFileChooser` 已经处理了。两个都不需要装插件。)

### 1.4 `allowNavigation` 要保持最短

目前只有网站自己的域名和子域名。这是最重要的一道安全边界:
不在列表里的 URL 会被丢到系统浏览器,拿不到原生插件。

`app.config.json` 的 `extraAllowedHosts` 保持为空。真要加,只加完全自己控制的域名。

### 1.5 bridge 只注入一个 origin

`native-bridge.js` 只注入到 `server.url` 那一个 origin。如果网站跳到别的域名
(`m.site.com`、第三方支付页),那个页面上 `window.Capacitor` 不存在,
`app-shell.js` 的所有功能都失效。

**实现时的影响**:任何依赖 `app-shell.js` 的功能都不能假设它在所有页面都在。
进度条、下载这些必须做在原生侧,原因就是这个。

---

## 第 2 部分:P0 —— 页面加载进度条

### 为什么必须做在原生侧

JS 方案(在 `app-shell.js` 里拦截点击、显示进度条)**不可行**:跨页面导航时
整个 JS 环境被销毁,新页面的脚本要等 HTML 到达才执行 —— 而等待 HTML 的那几百毫秒
到几秒正是需要显示进度的时间段。只有原生层知道"请求发出了,还没回来"。

### Android 实现

Capacitor 的 `BridgeWebChromeClient` **没有** override `onProgressChanged`,
所以可以安全地包一层。

`android/app/src/main/java/<appId>/MainActivity.java`:

```java
@Override
public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // 顶部加载进度条。Capacitor 的 BridgeWebChromeClient 没有处理 onProgressChanged,
    // 所以继承它并补上这一个方法是安全的(其他方法都走 super)。
    bridge.getWebView().setWebChromeClient(new ProgressChromeClient(bridge));
}
```

关键点:

- `extends BridgeWebChromeClient`,构造函数签名是 `BridgeWebChromeClient(Bridge bridge)`
- **只 override `onProgressChanged`,并且第一行调 `super.onProgressChanged(view, progress)`**
- 进度条用一个 `ProgressBar`(style `Widget.ProgressBar.Horizontal`)加到
  `bridge.getWebView()` 的父布局顶部,或者直接用一个高 3dp 的 `View` 自己做宽度动画
- 颜色用 `R.color.colorPrimary`(`configure.mjs` 已经把主题色写进 `colors.xml`)
- 行为:`progress < 100` 时显示并更新宽度;`== 100` 时淡出(200ms)后 `GONE`
- **加一个 150ms 的延迟出现**:缓存命中的页面瞬间就加载完了,
  进度条闪一下比没有更难看

### iOS 实现

iOS 要观察 `WKWebView.estimatedProgress`。Capacitor 没有用这个属性,
而且 **KVO 不抢 delegate**,所以这条路是安全的。

`CAPBridgeViewController` 提供了官方扩展钩子(全是 `open func`,源码已确认):

| 钩子 | 用途 |
|---|---|
| `webView(with frame:configuration:) -> WKWebView` | 创建 WebView 的时机 —— 在这里设属性、挂 KVO |
| `capacitorDidLoad()` | `webView` 和 `bridge` 都已就绪,还没加进视图树 —— 在这里做初始化 |
| `webViewConfiguration(for:)` | 改 `WKWebViewConfiguration` |

**不需要改 storyboard。** Capacitor 8 的实际入口是代码:
`ios/App/App/SceneDelegate.swift` 里 `window?.rootViewController = CAPBridgeViewController()`。
(storyboard 里也有一份指向 `CAPBridgeViewController` 的配置,但 SceneDelegate 这条路
才是生效的。)

步骤:

1. 新建 `ios/App/App/MainViewController.swift`:

```swift
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    private var progressObservation: NSKeyValueObservation?
    private let progressView = UIProgressView(progressViewStyle: .bar)

    // 创建 WebView 的官方钩子
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let wv = super.webView(with: frame, configuration: configuration)
        wv.allowsBackForwardNavigationGestures = true   // 侧滑返回
        return wv
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // 把 progressView 加到 view 顶部,约束到 safeAreaLayoutGuide.topAnchor
        // progressObservation = webView?.observe(\.estimatedProgress, options: [.new]) { ... }
        // observation 必须存成属性,否则会被立刻释放,回调永远不触发
    }
}
```

2. `SceneDelegate.swift` 把 `CAPBridgeViewController()` 换成 `MainViewController()`
   —— **就这一行**

3. 进度条颜色用 `app.config.json` 的 `themeColor`。
   iOS 侧没有自动同步主题色的机制(`configure.mjs` 只同步了 Android 的 `colors.xml`),
   要么在 `MainViewController` 里写死,要么顺手给 `configure.mjs` 加一个
   iOS 的颜色注入(写进 `Assets.xcassets` 的 Color Set,或者生成一个 Swift 常量文件)。
   **建议后者**,这样主题色仍然只在一个地方配置。

### 验收

- [ ] 点一个链接,进度条从左到右走完消失
- [ ] 把网络限速到 3G(Android 开发者选项 / iOS Network Link Conditioner),进度条明显可见
- [ ] 快速连点多个链接,进度条不会卡在中间不动
- [ ] 缓存命中的页面(秒开)不闪进度条
- [ ] **原生 bridge 还活着**:页面里 `window.Capacitor.nativePromise` 存在,
      下拉刷新和返回键还正常 —— 这是验证没有破坏 Capacitor 的关键一步
- [ ] iOS 侧滑返回可用

---

## 第 3 部分:P0 —— 文件下载

### 为什么

WebView 点 PDF、Excel、图片下载链接**完全没反应**,用户以为 app 坏了。
如果网站有任何"下载报表""导出"功能,这项是必须的。

### Android 实现

`WebView.setDownloadListener` —— Capacitor 完全没碰这个,安全。

```java
bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
    // 用系统 DownloadManager:进度显示在通知栏,断点续传、重试都是系统管
});
```

关键点:

- 用 `android.app.DownloadManager`,不要自己写 HTTP 下载
- `DownloadManager.Request` 要设:
  - `addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))`
    —— **最容易漏的一步**。需要登录才能下载的文件,不带 cookie 会下到一个登录页 HTML
  - `addRequestHeader("User-Agent", userAgent)`
  - `setMimeType(mimeType)`
  - `setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)`
  - `setNotificationVisibility(VISIBILITY_VISIBLE_NOTIFY_COMPLETED)`
- 文件名从 `contentDisposition` 解析,用
  `URLUtil.guessFileName(url, contentDisposition, mimeType)`
- `AndroidManifest.xml` 加权限:
  - Android 10+ 写公共 Downloads 目录不需要权限
  - 但下载完成通知需要 `POST_NOTIFICATIONS`(Android 13+,**要运行时请求**)
- 下载完给用户一个提示(Toast 或调 `app-shell.js` 的 toast)

### iOS 实现 —— 跟 Android 走不同的路,这是刻意的

**原生 `WKDownloadDelegate` 这条路在 Capacitor 上走不通**,源码已确认:

- `navigationDelegate` 被 Capacitor 的 `WebViewDelegationHandler` 占着,
  而且它在 bridge 里是 `public private(set) var`(`CapacitorBridge.swift:105`)
  —— **外部无法替换**
- 硬把 `webView.navigationDelegate` 指向自己的对象,
  Capacitor 那个 handler 就收不到回调了,
  会连带废掉 `errorPath`(离线页)、页面加载状态、JS bridge 的清理逻辑
- `WKDownloadDelegate` 本身 Capacitor 没实现,但要触发它必须先拿到
  `decidePolicyFor navigationResponse`,而那要靠 navigationDelegate

**所以 iOS 用 JS 侧方案**:在 `website/app-shell.js` 里拦截下载链接,
交给 `Browser.open()` → Safari View Controller,用户在那里能"存到文件"或分享到别的 app。
iOS 本来就没有"下载文件夹"的概念,这对 iOS 用户是符合预期的交互。

```js
// app-shell.js 的链接分流那一节里加:
var DOWNLOAD_EXT = /\.(pdf|xlsx?|docx?|csv|zip|rar|7z|pptx?|apk|ipa|dmg|mp4|mp3)$/i;
if (a.hasAttribute('download') || DOWNLOAD_EXT.test(url.pathname)) {
  if (AppShell.platform === 'ios') {
    e.preventDefault();
    AppShell.call('Browser', 'open', { url: url.href });
    return;
  }
  // Android 走原生 DownloadListener,这里不拦
}
```

**注意**:Safari View Controller 是独立的浏览器上下文,**不共享 WebView 的 cookie**。
需要登录才能下载的文件在 iOS 上会失败。解决办法:

- 后端给下载链接加一个一次性签名 token(`?t=<signed>`),有效期几分钟 ——
  这是推荐做法,顺便也解决了链接被转发的问题
- 或者 `AppShell.call('Share', 'share', { url })`,但那只是把 URL 分享出去,
  下载还是在别的 app 里发生,同样有 cookie 问题

**如果 iOS 下载是核心功能**(比如这是个发票/报表系统),那就在网站侧改成
"下载前先换一个带签名的短期 URL"。这个改动在服务器端,比跟 Capacitor 的
delegate 搏斗划算得多。

### 验收

Android:
- [ ] 点 PDF 链接 → 通知栏出现下载进度,完成后能打开
- [ ] 点需要登录才能下的文件 → 下到的是真文件,不是登录页 HTML(**cookie 那一步**)
- [ ] 文件名正确(不是 `download.bin` 之类),中文文件名不乱码

iOS:
- [ ] 点下载链接 → 打开 Safari View Controller,能"存到文件"
- [ ] **登录态文件**:先确认当前方案下会不会失败。如果失败,要么实现签名 URL,
      要么明确告知用户"iOS 上这个功能受限" —— 不要假装它能用
- [ ] 下载完能回到 app(不是被踢出去)

---

## 第 4 部分:P0 —— Safe area 适配

### 为什么

刘海屏、灵动岛、底部手势条会压住网站内容。这是审核员一眼能看出来的"这是个网页"信号。

### 实现

两边配合:

**原生侧**(`capacitor.config.ts` 已经设了 `ios.contentInset: 'always'`,先验证够不够):

- iOS:确认状态栏区域不被内容覆盖。`StatusBar` 插件的 `overlaysWebView: false` 已配
- Android:Capacitor 8 默认 edge-to-edge。如果内容顶到状态栏下面,
  在 `MainActivity` 里处理 `WindowInsets`,或者用 `@capacitor/status-bar` 的配置

**网站侧**(`website/app-shell.js` 已经加了 `in-app` class,用它):

```css
.in-app body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
/* 固定定位的元素要单独处理 */
.in-app .site-header { top: env(safe-area-inset-top); }
.in-app .bottom-nav  { padding-bottom: env(safe-area-inset-bottom); }
```

**前提**:网站的 `<meta name="viewport">` 必须有 `viewport-fit=cover`,
否则 `env(safe-area-inset-*)` 全是 0。这是最常见的失败原因。

### 验收

- [ ] iPhone 有刘海/灵动岛的机型:内容不被挡,顶部不留多余白条
- [ ] iPhone 底部手势条不压住网站的底部按钮
- [ ] Android 打孔屏正常
- [ ] 横屏也正常(左右的 safe area)

---

## 第 5 部分:P1 —— 推送通知完整链路

目前只有"插件装好了"。完整链路有 5 段,缺任何一段推送都收不到。

### 5.1 Firebase 配置

1. Firebase 控制台建项目
2. 加 Android app,包名填 `app.config.json` 里的 `appId`(必须完全一致)
3. 下载 `google-services.json` → 放 `android/app/`
   - `android/app/build.gradle` 末尾已经有自动检测逻辑:
     检测到这个文件就 apply `com.google.gms.google-services` 插件
   - 还要在 `android/build.gradle` 的 `dependencies` 加
     `classpath 'com.google.gms:google-services:4.4.2'`(**这一步现有代码里没有**)
4. 加 iOS app,bundle id 同样填 `appId`
5. 下载 `GoogleService-Info.plist` → 放 `ios/App/App/`,
   **并在 Xcode 里把它加进 target**(光放文件不够,必须在 project 里引用)
6. Apple 开发者后台建 APNs Auth Key(.p8),上传到 Firebase 的 Cloud Messaging 设置

`.gitignore` 已经排除了这两个凭据文件(里面有密钥)。CI 里通过 secret 注入,
参考 `android.yml` 里 keystore 的做法。

### 5.2 权限请求 + 拿 token

写在 `website/app-shell.js` 里(新增一节),或者单独一个 `app-push.js`。

```js
// 注意时机:不要一进 app 就弹权限请求 —— iOS 用户拒绝一次就很难再要回来。
// 正确做法是在用户做了某个表明他想要通知的动作之后再请求
// (比如下单成功、点了"关注"),或者先用自己的页面解释一下为什么需要。
async function registerPush() {
  const perm = await AppShell.call('PushNotifications', 'requestPermissions');
  if (perm?.receive !== 'granted') return;
  await AppShell.call('PushNotifications', 'register');
}
```

token 通过 `registration` 事件回来:

```js
Capacitor.addListener('PushNotifications', 'registration', (t) => {
  // POST 到你的服务器,和当前登录用户绑定
  fetch('/api/push-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token: t.value, platform: AppShell.platform }),
  });
});
```

**Android 13+ 必须在 `AndroidManifest.xml` 加 `POST_NOTIFICATIONS` 权限**,
并且是运行时请求 —— `requestPermissions` 会处理,但权限声明要自己加。

### 5.3 服务器侧(cPanel + PHP)

存 token 的表至少要有:`token`、`user_id`、`platform`、`updated_at`。
同一用户多设备要支持多条,token 会变(app 重装、清数据)所以要能更新和清理。

发送用 **FCM HTTP v1 API**(旧的 legacy API 已废弃):

- 需要 Firebase 的 service account JSON,用它换 OAuth2 access token
- cPanel 上 PHP 发送:`google/apiclient` 或者自己用 `openssl_sign` 做 JWT 再换 token
- **service account JSON 绝对不能放在 web 根目录下**,放 `public_html` 外面
- 发送失败返回 `UNREGISTERED` / `INVALID_ARGUMENT` 的 token 要从库里删掉,
  不然会越积越多

### 5.4 点击通知跳转

推送的 payload 里带上目标页面:

```json
{ "data": { "url": "https://yoursite.com/orders/12345" } }
```

JS 侧监听:

```js
Capacitor.addListener('PushNotifications', 'pushNotificationActionPerformed', (a) => {
  const url = a?.notification?.data?.url;
  if (url) window.location.href = url;   // 同站的话直接跳
});
```

**坑**:app 被完全杀掉时点通知,`app-shell.js` 要等网站加载完才注册监听,
这期间事件可能已经发完了。Capacitor 的插件会缓存最后一个 action,
但要验证。如果不行,退路是在原生侧把 URL 存起来,启动时作为初始 URL 加载。
**这一项必须专门测"app 完全退出后点通知"的场景。**

### 验收

- [ ] Android 前台 / 后台 / 完全退出,三种状态都能收到
- [ ] iOS 三种状态都能收到(iOS 要真机,模拟器收不到推送)
- [ ] 点通知能跳到 payload 指定的页面
- [ ] **app 完全杀掉后点通知,能跳对页面**(最容易坏的场景)
- [ ] 卸载重装后 token 会更新,服务器端旧 token 被清理
- [ ] 用户拒绝权限后 app 不崩、不反复弹窗

---

## 第 6 部分:P1 —— 深度链接

点网站链接直接打开 app(而不是浏览器)。也是 Apple 4.2 的加分项。

- Android:App Links —— `AndroidManifest.xml` 加 `<intent-filter>` 带
  `android:autoVerify="true"`,网站根目录放
  `/.well-known/assetlinks.json`(含 app 的签名指纹)
- iOS:Universal Links —— Xcode 开 Associated Domains capability
  (`applinks:yoursite.com`),网站放 `/.well-known/apple-app-site-association`
  (**必须 `Content-Type: application/json`,不能有 `.json` 后缀**)
- 两个文件都要 **https 且不能重定向**。cPanel 上注意 `.htaccess` 别把
  `.well-known` 重写掉了 —— 这是最常见的失败原因
- JS 侧用 `Capacitor.addListener('App', 'appUrlOpen', ...)` 处理路由

### 验收

- [ ] 在微信/短信里点网站链接 → 直接开 app 并到对应页面(不是浏览器)
- [ ] app 没装的时候 → 正常在浏览器打开
- [ ] `curl -I https://yoursite.com/.well-known/assetlinks.json` 返回 200 且无重定向

---

## 第 7 部分:P1 —— 为过审加的原生功能

**这是整个项目唯一真正的风险。** Apple 的 Guideline 4.2 要求 app 必须比
"重新打包的网站"更多;审核不看技术栈,只看这个 app 有没有给用户在 Safari 里
打不到的东西。而且 Apple 明确说过:**光加推送、定位、分享这些不足够**。

从下面挑 **2 到 3 个**真的跟业务相关的做掉,别全做:

| 功能 | 实现成本 | 说明 |
|---|---|---|
| 扫码 | 中 | 装 `@capacitor-mlkit/barcode-scanning`。零售/会员场景很自然 |
| 生物识别登录 | 中 | 社区插件 + 网站侧存一个长效 token。体验提升明显 |
| 离线阅读 | 中 | 见 P2。审核员会试飞行模式 |
| 保存到相册 | 低 | 图片类网站适合 |
| 原生底部 Tab 栏 | 低 | **纯 HTML/CSS 做在网站里也算**,配合 `.in-app` class。性价比最高 |
| 应用内评分 | 低 | 不算 4.2 的功能,但是正常 app 该有的 |

同时必须做的"去网页化"(成本低、效果直接):

- `.in-app` 下隐藏网站的顶部导航、面包屑、页脚链接堆、cookie 横幅、"下载 App"广告
- 不要有死链和半成品页 —— 审核员十几分钟就在找这些
- 要登录的站**必须在 App Review Notes 里给测试账号**,不给必拒
- 图标和截图**必须换掉占位图**(`npm run verify` 会一直提醒),
  模板类 app 容易撞 Guideline 4.3(a) Spam

---

## 第 8 部分:P2

### 8.1 离线缓存

网站加 Service Worker,缓存最近浏览的页面和静态资源。好处:启动快、
飞行模式能看东西(4.2 加分)。

**坑**:Capacitor 的 `server.resolveServiceWorkerRequests` 配置和
Service Worker 的交互在 Android 上历史上有坑(SW 接管请求后 bridge 可能不注入)。
加之前先在 Android 真机验证 `window.Capacitor` 还在。

### 8.2 强制更新提示

原生层读一个你服务器上的版本接口,版本太老就显示一个不可关闭的遮罩让用户去更新。
做在原生侧而不是网页侧,因为 WebView 崩了的时候网页提示也显示不出来。

---

## 第 9 部分:验收清单(全部实现完之后)

### 构建
- [ ] `npm run verify` 21 项全绿
- [ ] GitHub Actions 的 Android job 出 APK 成功
- [ ] GitHub Actions 的 iOS `verify` job 编译通过
- [ ] release AAB 能签名成功
- [ ] iOS 能上到 TestFlight

### 功能(真机,Android + iOS 各一台)
- [ ] 冷启动 → 启动页 → 网站首页,启动页正常收起(不卡住)
- [ ] 飞行模式冷启动 → 显示自定义离线页(不是浏览器错误页)
- [ ] 离线页点"重新加载",恢复网络后自动回到网站
- [ ] 导航有进度条
- [ ] 下拉刷新
- [ ] Android 返回键:有历史后退,首页双击退出
- [ ] iOS 侧滑返回
- [ ] 外站链接在系统浏览器打开(**不在 app 内**)
- [ ] 文件上传能弹选择器,`capture` 属性能直接开相机
- [ ] 文件下载成功,登录态文件也能下
- [ ] 刘海屏/手势条不挡内容
- [ ] 推送三种状态都能收,点击跳对页面
- [ ] 深度链接能开 app
- [ ] 登录状态在 app 重启后还在(cookie 持久化)

### 安全
- [ ] `allowNavigation` 里只有自己的域名
- [ ] `webContentsDebuggingEnabled: false`(release 构建)
- [ ] app 包里没有任何密钥(`unzip -p app.apk | grep -i` 扫一遍)
- [ ] `google-services.json` / `GoogleService-Info.plist` 没进 git
- [ ] keystore 没进 git,且已备份到安全的地方
- [ ] 网站有 CSP 响应头,至少限制 `script-src`

### 上架
- [ ] 图标和启动页已换掉占位图
- [ ] App Store 截图用真实页面
- [ ] App Review Notes 填了测试账号
- [ ] Google Play 的 Data safety、内容分级、App access 填完
- [ ] targetSdk 36(Play 从 2026-08-31 起的要求,现有代码已是 36)

---

## 第 10 部分:已知坑清单

实现前扫一眼,这些都是本项目搭建过程中实际踩到或从源码确认的。

1. **`cap add` 生成的 Java 包名不跟 appId 改**。改完 appId 直接构建会编译失败
   (`AndroidManifest` 里 `.MainActivity` 相对 namespace 解析不到类)。
   `scripts/configure.mjs` 已经处理(搬文件 + 改 package 声明 + 清旧目录),
   **但如果你重新 `cap add android`,记得再跑一次 `npm run sync`**。

2. **Xcode scheme 默认只在本机 `xcuserdata` 里,不进 git**。
   GitHub Actions 上 `xcodebuild -scheme App` 会直接失败。
   `configure.mjs` 会自动生成 shared scheme,**不要把
   `ios/App/App.xcodeproj/xcshareddata/` 加进 `.gitignore`**。

3. **SPM 模式下没有 `.xcworkspace`**,只有 `.xcodeproj`。
   `npx cap config --json` 报的 workspace 路径是默认值,实际不存在。
   所有 `xcodebuild` 命令用 `-project ios/App/App.xcodeproj`。

4. **不要替换 `BridgeWebViewClient`**。它承载了本地资源服务、bridge 注入、
   错误页跳转。要扩展就 `extends` 并每个 override 调 `super`。
   见 0.2 的说明。

5. **bridge 只注入 `server.url` 一个 origin**。跳到别的域名后
   `window.Capacitor` 就没了,`app-shell.js` 全部失效。
   所以进度条、下载必须做在原生侧。

6. **下载不带 cookie 会下到登录页**。`DownloadManager.Request` 必须
   `addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))`。

7. **`env(safe-area-inset-*)` 需要 viewport 有 `viewport-fit=cover`**,
   否则全是 0。这是 safe area 没效果的头号原因。

8. **iOS 权限请求时机**:用户拒绝一次通知权限就很难要回来。
   不要在 app 启动时就弹。

9. **`.well-known` 文件被 `.htaccess` 重写**是深度链接验证失败的头号原因。
   cPanel 上尤其常见,因为 WordPress 的 rewrite 规则很激进。

10. **Google Play 的 App access**:要登录才能用的 app 不给测试账号必拒,
    这条比 4.2 更容易被忽略。

11. **`npm run assets` 不加 `--android --ios` 会生成 59 个 PWA 图标**
    塞进 `www/` 和项目根目录。`package.json` 里已经限定了平台,别改回去。

12. **`versionCode` 必须递增**,Google Play 不接受重复或回退。
    workflow 用 `github.run_number`,所以不要重置或换仓库。

13. **iOS 的 `bridge.webViewDelegationHandler` 是 `private(set) var`**,替换不了。
    硬改 `webView.navigationDelegate` 会连带废掉离线页和 bridge 清理。
    扩展只能走 `webView(with:configuration:)` / `capacitorDidLoad()` / KVO。

14. **Capacitor 8 的 iOS 入口在 `SceneDelegate.swift`,不在 storyboard**。
    换 view controller 子类改那一行就行,不要去手改 storyboard XML
    (storyboard 里那份配置是摆设,改了没用还容易改坏)。

15. **Safari View Controller 不共享 WebView 的 cookie**。
    iOS 上凡是走 `Browser.open()` 的东西(下载、外链)都是未登录状态。
    要带登录态就得用签名 URL。

16. **`NSKeyValueObservation` 必须存成属性**,否则创建完立刻被释放,
    KVO 回调永远不触发。iOS 进度条不动十有八九是这个原因。

---

## 附录:环境信息

- Capacitor 8.6.2(当前稳定线是 8.x,Capacitor 9 还在 alpha)
- Android:minSdk 24,compileSdk / targetSdk 36
- iOS:minVersion 15.0,SPM(不是 CocoaPods)
- Node 22(Capacitor 8 要求 >= 22)
- Xcode:App Store Connect 从 2026-04-28 起拒收旧 Xcode 构建的上传,
  CI 用 runner 上的最新版

### 升级 Capacitor

```bash
npm install @capacitor/core@latest @capacitor/cli@latest \
  @capacitor/android@latest @capacitor/ios@latest
npx cap migrate
npm run sync
```

有原生改动之后升级,重点重新验证:进度条、下载、storyboard 的 customClass 引用。
