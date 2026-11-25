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

## 二、网站那边要加的文件(重要)

把 `website/app-shell.js` 上传到你网站根目录,然后在页面模板的 `</body>` 前加一行:

```html
<script src="/app-shell.js" defer></script>
```

WordPress 的话放在主题的 `footer.php`;PHP 站放在公共 footer 里。

做完深度链接那一节之后,`website/.well-known/` 下的两个文件也要上传到网站根目录,
它们不是可选的 —— 没有这两个文件,点链接只会在浏览器里打开。

要推送的话再加一个 `app-push.js`,放在 `app-shell.js` 之后(见第七节)。

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
| iOS 文件下载 | iOS 上点下载链接没反应(安卓走原生,不受影响) |
| safe area 变量 | 网站拿不到统一的 `--app-safe-*`,刘海屏要分平台写两套 |
| 深度链接跳转 | 点链接能开 app,但只会停在首页,不会到目标页面 |

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

### 文件下载

两个平台走的是**不同的路**,这是刻意的,不是偷懒。

| | 实现 | 文件去哪 |
|---|---|---|
| Android | 原生 `WebView.setDownloadListener` → 系统 `DownloadManager` | 公共「下载」目录,通知栏有进度 |
| iOS | `app-shell.js` 拦下载链接 → `Browser.open()`(Safari View Controller) | 用户自己选「存到文件」 |

iOS 之所以不走原生:`navigationDelegate` 被 Capacitor 的 `WebViewDelegationHandler`
占着,而且是 `private(set)`,拿不到 `WKDownloadDelegate`。硬抢会连带废掉离线页和
bridge 清理,代价远大于收益。

**iOS 有一个必须知道的限制**:Safari View Controller 不共享 WebView 的 cookie,
所以**需要登录才能下载的文件在 iOS 上会失败**(下到的是登录页)。两个办法:

1. **推荐**:后端给下载链接发一个带签名的短期 URL(`?t=<signed>`,有效期几分钟),
   顺便也解决了链接被转发的问题。这个改动在服务器端,比跟 Capacitor 搏斗划算
2. 或者明确告诉用户 iOS 上这个功能受限 —— 不要假装它能用

哪些链接算下载:带 `download` 属性的 `<a>`,或者路径以
`.pdf .xls(x) .doc(x) .csv .zip .rar .7z .ppt(x) .apk .ipa .dmg .mp4 .mp3` 结尾的。
像 `/export?type=pdf` 这种**路径里没有扩展名**的导出接口认不出来,给那个 `<a>`
加上 `download` 属性就行。要改这个列表,改 `app-shell.js` 里 `CONFIG.downloadExtensions`。

Android 侧还有两点:下载请求会**带上 WebView 的 cookie**(所以登录态文件能下),
以及 `POST_NOTIFICATIONS` 权限是在用户第一次点下载时才请求的(Android 13+),
拒绝了下载照样进行,只是通知栏不显示进度。

### Safe area(刘海屏、灵动岛、底部手势条)

**大部分活 Capacitor 已经干了,别重复实现。** Capacitor 8 的
`@capacitor/android` 核心里有一个自动注册的 `SystemBars` 插件
(`Bridge.java` 无条件 `registerPlugin`),它在 decorView 上挂
`OnApplyWindowInsetsListener`,并且**总是**往页面注入
`--safe-area-inset-top/right/bottom/left` 四个 CSS 变量。iOS 那边则由
`StatusBar` 的 `overlaysWebView: false` 把 WebView 的 frame 往下挪,
加上 `ios.contentInset: 'always'` 处理滚动内容的 inset。

所以**不要**照着「在 MainActivity 里自己处理 WindowInsets」去写 ——
那会和 `SystemBars` 的 decorView padding 打架,把内容挤两次。

#### 两种模式

`app.config.json` 的 `safeArea` 选一个,并且让 `app-shell.js` 里
`CONFIG.safeArea` 保持一致(一个在原生侧,一个在网站侧,脚本读不到前者):

| | `"native"`(默认) | `"cover"` |
|---|---|---|
| 页面 viewport | 不加 `viewport-fit=cover` | 要有 `viewport-fit=cover` |
| Android | 原生把 WebView 让开系统栏 | inset 透传给页面 |
| 注入的 CSS 变量 | 全是 `0` | 真实值 |
| iOS `env()` | 恒为 `0` | 真实值 |
| 网站要改吗 | **不用改** | 必须自己让开,否则内容被挡 |
| 代价 | 系统栏那条是纯色,不能让内容铺过去 | 要动网站 CSS |

先用 `native`:现有网站不动一行 CSS 就不会被刘海挡住。等需要「内容铺到
屏幕边缘」的效果,或者发现 iOS 上固定底栏压在手势条上时,再换 `cover`。

#### 换成 cover 之后,网站侧怎么写

`app-shell.js` 把两个来源合成了一组变量,**任何情况下都能直接用**
(没有 inset 时就是 `0`):

```css
/* 固定在顶部/底部的元素:加 padding,不要改 top/bottom */
.in-app .site-header { padding-top: var(--app-safe-top); }
.in-app .bottom-nav  { padding-bottom: var(--app-safe-bottom); }
/* 横屏时左右也有 inset */
.in-app .full-bleed  { padding-left: var(--app-safe-left); padding-right: var(--app-safe-right); }
```

懒人可以直接加 class:`app-safe-top` `app-safe-bottom` `app-safe-x`
`app-safe-inset` `app-safe-fixed-top` `app-safe-fixed-bottom`。
网站自己的选择器更具体时工具类会不生效,那就写上面那种 `var(...)` 形式。

调试用:`AppShell.safeArea()` 返回 `{top, right, bottom, left}` 的真实像素值
(自定义属性用 `getPropertyValue` 读到的是没解析的字面量,所以这个函数
内部拿一个隐藏元素当 padding 算了一遍)。真机上先用它确认 inset 到底是多少。

**最常见的失败原因**:`env(safe-area-inset-*)` 全是 0 —— 因为 viewport 里
没有 `viewport-fit=cover`。最好直接写在网站自己的 meta 里:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

`app-shell.js` 在 `CONFIG.safeArea === 'cover'` 时也会兜底改这个 meta,但脚本是
`defer` 的,改完会多一次重排,首屏可能抖一下。

### 深度链接(点网站链接直接开 app)

原生侧已经配好了,`app.config.json` 的 `siteUrl` 一改,host 自动同步到两处:

| 平台 | 文件 | 内容 |
|---|---|---|
| Android | `android/app/src/main/AndroidManifest.xml` | `<intent-filter android:autoVerify="true">` 里的 `android:host` |
| iOS | `ios/App/App/App.entitlements` | `applinks:<host>`,并且 `CODE_SIGN_ENTITLEMENTS` 已经指向它 |

网站侧要你做三件事,**少一件就不生效**。

#### 1. 填 Android 的签名指纹

`npm run configure` 会生成 `website/.well-known/assetlinks.json`,里面的
`REPLACE_WITH_SHA256_CERT_FINGERPRINT` 要换成你 release keystore 的 SHA-256 指纹:

```bash
keytool -list -v -keystore release.keystore -alias <你的 alias> | grep SHA256
```

格式是 `AB:CD:EF:...` 那种带冒号的大写十六进制。

> 调试和正式签名的指纹不一样。用 Android Studio 的 debug keystore 装的包要验证通过,
> 得把 debug 的指纹也加进 `sha256_cert_fingerprints` 数组(可以放多个)。
> 如果走 Google Play 应用签名,要用 **Play 后台 → 应用完整性** 里那个
> 「应用签名密钥证书」的指纹,不是你本地 keystore 的。这是最容易搞错的一步。

#### 2. 填 iOS 的 Team ID

`website/.well-known/apple-app-site-association` 里的
`REPLACE_WITH_TEAM_ID` 换成你的 10 位 Team ID(Apple 开发者后台右上角,
或 Membership 页面),最终形如 `A1B2C3D4E5.com.yoursite.app`。

填完之后再跑 `npm run configure` **不会**覆盖这两个文件 —— 脚本只在文件不存在、
或者里面还留着 `REPLACE_WITH` 占位符时才写。

#### 3. 把两个文件放到网站根目录

```
https://yoursite.com/.well-known/assetlinks.json
https://yoursite.com/.well-known/apple-app-site-association
```

硬要求:

- **https,且不能重定向**(301/302 都算失败)。`curl -I` 必须直接 200
- `apple-app-site-association` **没有** `.json` 后缀,而且响应头必须是
  `Content-Type: application/json`。cPanel 上一般要在 `.htaccess` 里加一行:
  ```apache
  <Files "apple-app-site-association">
    ForceType application/json
  </Files>
  ```
- **cPanel 上最常见的失败原因是 `.htaccess` 把 `.well-known` 重写掉了**,
  WordPress 的 rewrite 规则尤其激进。确认规则里有
  `RewriteCond %{REQUEST_URI} !^/\.well-known/` 之类的放行,或者把
  `.well-known` 排在重写规则前面

验证:

```bash
curl -I https://yoursite.com/.well-known/assetlinks.json
curl -I https://yoursite.com/.well-known/apple-app-site-association
```

#### iOS 签名的额外一步(容易漏)

`App.entitlements` 里的 `com.apple.developer.associated-domains` 要求
**Apple 开发者后台的 App ID 上打开 Associated Domains 能力**,否则
provisioning profile 对不上,**签名构建会失败**(TestFlight 那个 job 会挂)。
无证书的编译验证不受影响。去 Certificates, Identifiers & Profiles →
Identifiers → 你的 App ID → 勾上 Associated Domains → 重新生成 profile。

#### 跳转行为

`app-shell.js` 监听 `appUrlOpen`,同站的 URL 直接 `location.href` 过去。
两端原生发这个事件都带 `retainUntilConsumed`,所以 app 完全没启动时点链接,
事件会留着等脚本注册上再送过来,不会丢。

代价:`server.url` 模式下冷启动会**先加载网站首页,再跳到目标页**,也就是两次加载。
想避免得在原生侧把 URL 存下来当初始 URL,成本大得多,目前没做。

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

完整链路有五段,缺任何一段推送都收不到。下面按"谁来做"分开写。

### 已经做好的(代码在仓里)

| 段 | 在哪 |
|---|---|
| Android 的 google-services 插件接线 | `android/build.gradle` 已有 classpath;`android/app/build.gradle` 末尾检测到 `google-services.json` 就自动 apply |
| Android 通知权限声明 | `AndroidManifest.xml` 的 `POST_NOTIFICATIONS`,运行时请求在用户点下载或开通知时才发 |
| iOS 的 `aps-environment` entitlement | `app.config.json` 里 `enablePushNotifications: true` 时由 `configure.mjs` 写进 `App.entitlements` |
| iOS 把 `GoogleService-Info.plist` 加进 Xcode target | 同上,`configure.mjs` 直接改 `project.pbxproj`(**光把文件放对位置不够**,而没有 Mac 的人没法在 Xcode 里拖文件) |
| 网站侧的权限请求、token 上报、点击跳转 | `website/app-push.js` |
| CI 注入两个凭据文件 | `android.yml` / `ios.yml` 里按 secret 还原,没配就跳过 |
| 服务器侧示例 | `server/` 下三个文件(**没在真实环境跑过,是示例**) |

### 1. Firebase(你来做)

1. `app.config.json` 里 `enablePushNotifications` 改成 `true`,跑 `npm run sync`
2. Firebase 控制台建项目
3. 加 Android app,包名填 `app.config.json` 里的 `appId`,**必须完全一致**
4. 下载 `google-services.json` → 放 `android/app/`
5. 加 iOS app,bundle id 同样填 `appId`
6. 下载 `GoogleService-Info.plist` → 放 `ios/App/App/`
7. Apple 开发者后台建 APNs Auth Key(.p8),上传到 Firebase 的 Cloud Messaging 设置
8. Apple 开发者后台给 App ID **打开 Push Notifications 能力**,重新生成 provisioning profile

两个凭据文件带密钥,已经在 `.gitignore` 里。CI 里通过 secret 注入:

| secret | 内容 |
|---|---|
| `ANDROID_GOOGLE_SERVICES_JSON` | `google-services.json` 的全文 |
| `IOS_GOOGLE_SERVICE_INFO_PLIST` | `GoogleService-Info.plist` 的全文 |

没配这两个 secret 的话 CI 会打印一条 notice 然后继续 —— 但注意:
**`enablePushNotifications: true` 之后 `GoogleService-Info.plist` 已经进了 Xcode
target,iOS 构建缺这个文件会直接失败。** 要么配 secret,要么把开关关回去。

### 2. 网站侧(加一个文件)

```html
<script src="/app-shell.js" defer></script>
<script src="/app-push.js" defer></script>
```

`app-push.js` 自动做三件事:已经授权过的用户静默重新注册(token 会变,重装和清
数据之后都要重新上报)、token POST 到 `/api/push-token`、点通知跳到 payload 里的 url。

**它刻意不自己弹权限请求。** iOS 用户拒绝一次就很难再要回来,所以要由网站在
"用户做了某个表明他想要通知的动作"之后调:

```js
// 下单成功之后、点了"关注"之后、设置页的通知开关里
AppShell.push.register().then(function (ok) {
  if (ok) AppShell.toast('已开启通知');
});
```

不要在页面加载时调。要改接口地址就改 `app-push.js` 里的 `CONFIG.tokenEndpoint`。

### 3. 服务器侧(你来做,`server/` 下有示例)

```
server/schema.sql              push_tokens 表
server/push-token.php.example  接收 token,upsert 进表
server/send-push.php.example   用 FCM HTTP v1 发送
```

**这三个文件没在真实环境跑过**,只过了 `php -l`。至少要改两处:怎么从会话里取
当前用户、怎么连数据库。几个要点:

- 旧的 legacy FCM API **已经废了**,必须用 HTTP v1
- 示例没用 `google/apiclient`:cPanel 上装 composer 依赖经常不顺,而这件事只需要
  用 service account 的私钥签个 JWT 换 access token,`openssl_sign` 就够了
- **service account JSON 绝对不能放在 `public_html` 下面**,放外面,权限 600
- 同一用户多设备要支持多条 token,所以主键是 token 不是 user_id
- 发送返回 `UNREGISTERED` / `INVALID_ARGUMENT` 的 token 要**从库里删掉**,
  不然会越积越多,每次群发都白白浪费请求。示例里已经这么做了
- 用户退出登录时把那条 token 的 user_id 清掉,不然换人登录同一台设备会收到别人的推送

### 4. 点通知跳转

推送 payload 里带目标页面(`data` 里的值必须是字符串):

```json
{ "message": { "token": "...", "notification": { "title": "订单已发货", "body": "点开看物流" },
  "data": { "url": "https://yoursite.com/orders/12345" } } }
```

`app-push.js` 只跳同站 URL —— 推送内容是从服务器来的,不该让它把用户带到任意站点。

**关于"app 被完全杀掉时点通知"**:核对过 Capacitor 8 的源码,
`pushNotificationActionPerformed` 两端都是 `retainUntilConsumed` 发的
(Android `PushNotificationsPlugin.java:86`,iOS `PushNotificationsHandler.swift:79`),
所以事件会一直留着,等 `app-push.js` 注册上监听再送过来,不会丢。
不过 **iOS 的 `registration` 事件没有 retain**,所以监听必须在调 `register()`
之前挂好 —— `app-push.js` 就是这个顺序,别调整。

这一项仍然要专门在真机上测,三种状态都要测(前台、后台、完全退出)。

### 暂时不要推送

`enablePushNotifications` 保持 `false` 就行,这一节整个跳过。
`configure.mjs` 会把 iOS 那两处(entitlement 和 Xcode target 引用)也清掉,
所以不会因为少凭据文件而构建失败。

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
  app-shell.js           ← 上传到你的网站根目录(见第二节)
  app-push.js            ← 要推送才需要,放在 app-shell.js 之后(见第七节)
  .well-known/           ← 也上传到网站根目录,深度链接要用
    assetlinks.json              Android,指纹要手填
    apple-app-site-association   iOS,Team ID 要手填(没有 .json 后缀是故意的)
server/                  服务器侧示例(PHP,没在真实环境跑过,见第七节)
  schema.sql             push_tokens 表
  push-token.php.example 接收 token
  send-push.php.example  用 FCM HTTP v1 发送
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
