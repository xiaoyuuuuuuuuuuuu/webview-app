# 网站 → App(Capacitor 壳)

把你的网站包成 iOS / Android 原生 app。网站内容一改,app 里立刻就变,不用重新上架。

功能上对标 WebViewGold 那类模板:启动页、自定义离线页、下拉刷新、返回键、
外链走系统浏览器、推送通知接口、原生图标。区别是代码和证书全在你自己手里,
没有订阅费,也没有 license 按 app 数量算的问题。

---

## 一、快速开始

### 1. 改 `app.config.json`

**整个项目你只需要改这一个文件。**

```json
{
  "siteUrl": "https://你的网址.com",
  "appName": "你的 App 名字",
  "appId": "com.你的公司.app",

  "themeColor": "#1565C0",
  "splashBackground": "#ffffff",
  "statusBarStyle": "light"
}
```

几点注意:

- `siteUrl` 必须是 **https**。http 的站 WebView 会直接拒绝加载。
- `appId` 一旦上架就**永远不能改**,现在想清楚。格式是反过来的域名,
  比如域名 `shop.com` → `com.shop.app`。只能小写字母、数字和点。
- `extraAllowedHosts` 平时留空。只有当你的站要跳到别的域名并且那个页面
  **必须留在 app 里**(比如自建的支付页)才加进去 —— 每加一个都是放宽安全边界,
  见下面「安全」一节。

### 2. 装依赖、套用配置

```bash
npm install
npm run sync
```

`npm run sync` 做两件事:把 `app.config.json` 的设置写进 Android/iOS 项目
(包含 app 名、包名、主题色、Java 包路径、Xcode scheme),然后同步 web 资源和插件。

**以后每次改完 `app.config.json` 都要重新跑一次 `npm run sync`。**

### 3. 换图标

现在用的是占位图标(主题色底 + app 名首字母)。换成你自己的:

```bash
# 把 assets/icon.png 换成你的图(1024x1024 PNG,别留透明边,别留圆角 —— 系统会自己裁)
npm run assets
```

启动页同理:`assets/splash.png` 和 `assets/splash-dark.png`(都是 2732x2732)。

想重新生成占位图(比如改了主题色):`npm run assets:placeholder`

### 4. 出安装包

见下面「三、怎么出安装包」。

---

## 二、网站那边要加一个文件(重要)

把 `website/app-shell.js` 上传到你网站根目录,然后在页面模板的 `</body>` 前加一行:

```html
<script src="/app-shell.js" defer></script>
```

WordPress 的话放在主题的 `footer.php`;PHP 站放在公共 footer 里。

**这个脚本在普通浏览器里什么都不做**(第一个判断就退出了),所以可以无条件加到所有页面,
不会影响网站本身,也不用判断 User-Agent。

它负责原生层做不到的那几件事:

| 功能 | 不加会怎样 |
|---|---|
| 收起启动页 | app 一直停在启动页上 |
| 安卓返回键 | **在首页按返回,app 卡住不退出** |
| 下拉刷新 | 没有下拉刷新 |
| 断网提示条 | 断网时没提示(但会显示离线页) |
| `target="_blank"` 链接 | 安卓上点了没反应 |

第二条是硬伤,所以这个文件实际上是必须的,不是可选增强。

脚本开头的 `CONFIG` 块可以调(双击退出、下拉刷新开关等)。它还会给 `<html>` 加
`in-app`、`in-app-ios`、`in-app-android` 这几个 class,方便你用 CSS 针对 app 做调整:

```css
/* 在 app 里就不用再显示「下载我们的 App」横幅了 */
.in-app .app-download-banner { display: none; }
```

另外它暴露了 `window.AppShell`:

```js
AppShell.toast('已保存');
AppShell.share({ title: '看看这个', url: location.href });  // 调起系统分享
AppShell.platform;  // 'ios' | 'android'
```

---

## 三、怎么出安装包

### 路线 A:GitHub Actions(推荐,不用 Mac 也不用装 Android Studio)

把项目推到一个 GitHub 仓库(私有的也行):

```bash
git init
git add .
git commit -m "webview app"
git branch -M main
git remote add origin git@github.com:你的账号/你的仓库.git
git push -u origin main
```

然后去仓库页面的 **Actions** 标签:

- **Android** → Run workflow → 跑完在页面下方下载 `app-debug-apk`。
  这个 APK 可以直接发给人装到安卓手机上(需要允许「安装未知来源应用」)。
  **零配置,推上去就能跑。**

- **iOS** → `verify` 这个 job 也是零配置的,它只验证能不能编译通过。
  **先把它跑绿**,证明项目没问题,再去弄证书。

上架用的包需要签名,见下面两节。

### 路线 B:本地构建(需要 Android Studio / Xcode)

```bash
npm run build:android          # debug APK
npm run open:android           # 在 Android Studio 里打开
npm run open:ios               # 在 Xcode 里打开(需要 Mac)
```

---

## 四、Android 签名和上架

### 生成 keystore(只需要一次,务必备份)

```bash
keytool -genkey -v -keystore release.keystore -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

**这个文件丢了就再也无法更新你已上架的 app** —— 备份到安全的地方,
密码也记好。`.gitignore` 已经排除了 `*.keystore`,不会误提交。

### 配到 GitHub

```bash
base64 -w 0 release.keystore          # Linux
base64 -i release.keystore | tr -d '\n'   # macOS
```

把输出贴到 GitHub 仓库 → Settings → Secrets and variables → Actions → New secret:

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 上面那串 base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | key 密码 |

配好之后 Actions → Android → Run workflow 会多出一个 `app-release-aab` 产物,
那个 `.aab` 就是上传 Google Play 的文件。

版本号:`versionCode` 自动用 GitHub 的运行次数(每次递增,Play 要求必须递增),
`versionName` 在 Run workflow 的输入框里填。

### Google Play 的硬要求

新 app 和更新都必须 target API 36(2026-08-31 起生效)。本项目已经是 36,不用改。
另外 Play Console 里要填完 Data safety、内容分级、以及 App access
(如果你的站要登录才能看,必须给审核员一个测试账号,不给就会被拒)。

---

## 五、iOS 上架

没有 Mac 也能做,用 App Store Connect API Key 让 Xcode 自己管签名。

1. App Store Connect → Users and Access → Integrations → App Store Connect API
2. 建一个 key,角色选 **App Manager**,下载 `.p8` 文件 —— **只能下载一次**
3. GitHub secrets 加这四个:

| Secret | 哪里找 |
|---|---|
| `APPLE_API_KEY_ID` | key 列表里那个 10 位 ID |
| `APPLE_API_ISSUER_ID` | 同一页顶部的 Issuer ID(一长串 UUID) |
| `APPLE_API_KEY_P8` | `.p8` 文件的全部内容,连 `-----BEGIN` 那几行一起贴 |
| `APPLE_TEAM_ID` | 开发者账号的 Team ID(10 位) |

4. Actions → iOS → Run workflow,把 **upload** 勾上 → 自动打包并传到 TestFlight

注意 Xcode 要求:App Store Connect 从 2026-04-28 起拒收用旧版 Xcode 构建的上传,
workflow 用的是 runner 上的最新 Xcode,所以这块不用操心。

---

## 六、上架前必读:Apple 会拿什么理由拒你

这是整个项目**唯一真正的风险**,而且跟用什么技术做没关系。

### Guideline 4.2(Minimum Functionality)

Apple 的原则是:app 必须比「重新打包的网站」更多。审核不看你怎么做的,
只看**这个 app 有没有给用户在 Safari 里打开网站拿不到的东西**。

而且 Apple 明确说过:光加推送、定位、分享这些,**不足以**构成足够的体验。

能明显降低风险的做法:

- **让它一打开就不像网站**。用 CSS 在 `.in-app` 下隐藏网站的顶部导航栏、
  面包屑、页脚那一堆链接、cookie 横幅、「下载 App」广告。
- **加一个原生感的底部 Tab 栏**(纯 HTML/CSS 做在网站里也算),
  别让用户靠网页里的超链接导航。
- **离线能用一点东西**。本项目已经有自定义离线页,再往前一步:
  让最近看过的页面能离线打开(网站加 Service Worker 缓存)。
- **用上真正需要原生的能力**:扫码、生物识别登录、相机上传、保存到相册。
  挑一两个跟你业务真的相关的做掉。
- **别有死链和半成品页**。审核员十来分钟就在找这些。
- **登录站一定要给测试账号**,写在 App Review Notes 里。

### Guideline 4.3(a)(Spam)

这条专门坑模板类产品:如果你的 app「二进制、元数据或概念跟其他开发者提交的
app 高度相似,只有细微差别」就会被拒。用同一个模板的人多了就容易撞。

本项目是你自己的代码,不是公共模板,这条风险本身就低。再注意:

- 图标、启动页**一定要换掉占位图**
- App Store 的截图用你自己网站的真实页面
- 描述文字自己写,别用模板里的套话

### 现实预期

Google Play 这边 webview 壳基本没问题。App Store 这边,纯壳子被拒是常态,
做了上面那些调整之后通常能过。被拒了也不是终点 —— 按拒审信里说的补,再提交。

---

## 七、推送通知

本项目已经装好 `@capacitor/push-notifications`,但要真正用起来还需要配 Firebase:

1. `app.config.json` 里把 `enablePushNotifications` 设成 `true`
2. 去 Firebase 建项目,加 Android 和 iOS 两个 app(包名填你的 `appId`)
3. 下载 `google-services.json` → 放到 `android/app/`
4. 下载 `GoogleService-Info.plist` → 放到 `ios/App/App/`
5. iOS 还要在 Apple 开发者后台开 Push Notifications capability,
   并把 APNs key 上传到 Firebase
6. 网站侧调 `AppShell.call('PushNotifications', 'register')` 拿 token,
   存到你的服务器

这两个凭据文件已经在 `.gitignore` 里了(里面有密钥,不要提交)。

**如果暂时不需要推送,这一节整个跳过,不配也不影响 app 正常跑。**

---

## 八、安全(这块跟普通网站不一样,值得读)

在 WebView 里,**XSS 不再只是网页 bug**。注入的脚本能调用所有已安装的原生插件
(文件系统、通讯录、相机、安全存储),所以 WebView 的加固要当成原生级别的风险来对待。

本项目已经做的:

- `allowNavigation` 只放了你自己的域名。其他任何链接(外站、广告、第三方登录页)
  都会被 Capacitor 丢给系统浏览器,**在 app 的 WebView 外面打开**,
  拿不到原生插件。这是最重要的一道防线。
- `cleartext: false` + `allowMixedContent: false` —— 只走 https,
  https 页面里也不许加载 http 资源。
- `webContentsDebuggingEnabled: false` —— 关掉远程调试,
  不然别人可以用 Chrome DevTools 连上用户手机里的 app。
- 只装了壳层真正需要的 7 个插件。**没装** Filesystem、Camera、Contacts
  这些高危插件 —— 需要再加,但每加一个都是在扩大 XSS 的影响面。

你还应该做的:

- **网站本身的 XSS 防护比平时更重要**。输出转义、CSP 头、上传文件校验。
- `extraAllowedHosts` 保持为空。真要加,只加你自己完全控制的域名。
- 网站加 CSP 响应头,至少限制 `script-src`。
- 别把任何密钥放进 app 里(app 包可以被解开看)。所有敏感操作在服务器上做鉴权。

---

## 九、一个需要知道的权衡

这个方案用 Capacitor 的 `server.url` 直接加载线上网站。

要说清楚的是:**Capacitor 官方文档说这个选项是给开发期 live-reload 用的,
不是为生产环境设计的**,Ionic 团队也确认过这一点。很多团队在生产用它(也能用),
但它的代价是真实的:

- **每次启动都要从服务器拉全部内容**。网慢的时候启动就慢。
- **完全没网时打不开**(所以才有自定义离线页兜底)。
- 原生层和网站的版本对不上时,排查会比较绕。

换个说法:这就是「网站变 app」这件事本身的代价,不是这个项目的 bug —— 
WebViewGold 那类产品是一样的架构,一样的代价。

**什么时候该换方案**:如果你希望 app 离线也能用大部分功能、启动要快、
或者想要真正的原生交互,那就不该做壳,而是把前端做成 SPA 打包进 app
(`webDir` 模式),或者干脆做原生。那是另一个量级的工程。

另外一个技术细节:原生 bridge 只注入到 `siteUrl` 那一个域名。
如果你的网站会跳到别的域名(比如 `m.yoursite.com`),
那个页面上 `app-shell.js` 就不工作了。尽量让 app 待在一个域名里。

---

## 十、文件说明

```
app.config.json          ← 你唯一需要改的文件
capacitor.config.ts      读 app.config.json,生成 Capacitor 配置
scripts/
  configure.mjs          把配置套用到 Android/iOS 项目(含包名迁移、Xcode scheme)
  make-placeholder-assets.py   生成占位图标
  templates/             离线页、兜底页、Xcode scheme 的模板
website/
  app-shell.js           ← 上传到你的网站(见第二节)
assets/
  icon.png               1024x1024,换成你的
  splash.png             2732x2732
  splash-dark.png        2732x2732
www/                     自动生成,不用管(已在 .gitignore)
android/  ios/           原生项目。只有进度条那一项手改过原生代码,改动集中在
                         MainActivity.java 和 ios/App/App/MainViewController.swift
                         (每个文件顶部有注释说明为什么改)
.github/workflows/       云端构建
```

### 常用命令

```bash
npm run sync             # 改完 app.config.json 后跑这个
npm run assets           # 换完 assets/icon.png 后跑这个
npm run build:android    # 本地出 debug APK
npm run doctor           # 检查 Capacitor 环境
npm run open:android     # Android Studio
npm run open:ios         # Xcode(需要 Mac)
```

### 升级 Capacitor

```bash
npm install @capacitor/core@latest @capacitor/cli@latest \
  @capacitor/android@latest @capacitor/ios@latest
npx cap migrate
npm run sync
```

有原生改动,升级后要重新验证这几项:

- **Android 进度条**:`BridgeWebChromeClient` 是否开始自己处理 `onProgressChanged`
  (现在它没有,所以继承后只补这一个方法是安全的);
  `capacitor_bridge_layout_main.xml` 的根布局有没有换掉
- **iOS 进度条**:`CAPBridgeViewController` 的 `webView(with:configuration:)` 和
  `capacitorDidLoad()` 还是不是 `open`;`view` 是不是仍然等于 `webView`
- **iOS 入口**:`SceneDelegate.swift` 里 root view controller 还是不是
  `MainViewController()` —— `npx cap migrate` 有可能把这个文件覆盖回模板
- 跑一遍真机:导航时有进度条,并且页面里 `window.Capacitor.nativePromise` 还在
  (后者是验证没破坏 bridge 的关键)
