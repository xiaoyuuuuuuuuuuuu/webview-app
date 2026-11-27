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
  "splashBackgroundDark": "",
  "statusBarStyle": "auto"
}
```

几点注意:

- `siteUrl` 必须是 **https**。http 的站 WebView 会直接拒绝加载。
- `appId` 一旦上架就**永远不能改**,现在想清楚。格式是反过来的域名,
  比如域名 `shop.com` → `com.shop.app`。只能小写字母、数字和点。
- `themeColor` 是品牌色:进度条、通知图标,还有 **Android 的状态栏底色**。
  `statusBarStyle` 管状态栏图标深浅,留 `"auto"` 就行 —— Android 按 `themeColor`
  挑对比度高的那个(`#1565C0` 上是白图标),iOS 跟系统深浅色走。
  也可以写死成 `"light"`(深色图标)或 `"dark"`(白图标),选了看不清的组合 `verify` 会提醒。
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
**但 Android 12 起系统不用这两张图**:启动页固定是「背景色 + app 图标」,
背景色取 `splashBackground`;深色模式取 `splashBackgroundDark`,留空就用同一个色。
网站有深色模式的话,把它填成网站的深色背景色,不然深色模式下冷启动会先白一下。
这两张图只在 iOS 和 Android 11 及以下用。

有些手机上启动页头 ~2 秒的状态栏图标沿用上一个界面(实测 TECNO:从桌面点开是白图标,
配白色启动页就看不见),这一段是系统画的,配置管不到。实测数据见 TESTING.md 第 6 节。

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
要过 Apple 4.2 还要加 `sw.js`(放根目录)和 `app-tabbar.js`(见第六节)。

全套大概是这样:

```html
<script src="/app-shell.js" defer></script>
<script src="/app-tabbar.js" defer></script>
<script src="/app-push.js" defer></script>
```

加上根目录的 `/sw.js` 和 `/.well-known/` 下那两个文件。

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

另外它暴露了 `window.AppShell` —— 这是网站侧唯一要记的接口。

### AppShell 接口

| 成员 | 说明 |
|---|---|
| `AppShell.version` | 壳的版本号。用户装的 app 可能比网站旧好几个版本,调新接口前先看它 |
| `AppShell.platform` | `'ios'` / `'android'` |
| `AppShell.has(name)` | 这个能力在不在 |
| `AppShell.capabilities()` | 一次拿到所有能力的状态,排查时用 |
| `AppShell.invoke(plugin, method, opts)` | **严格版**调用:失败 reject,`err.code` 可判断 |
| `AppShell.call(plugin, method, opts)` | **宽松版**:失败一律 `null` |
| `AppShell.toast(text, ms)` | 提示条 |
| `AppShell.share({ title, url })` | 调起系统分享 |
| `AppShell.safeArea()` | 四个方向 inset 的真实像素值 |
| `AppShell.biometric.verify(o)` | 弹生物识别。**不是登录**,见下 |
| `AppShell.biometric.check()` | 这台设备能不能用生物识别 |
| `AppShell.saveImage(path, o)` | 存一张图到相册 |
| `AppShell.notify(o)` | 弹本地通知,resolve 出通知 id。**不是推送** |
| `AppShell.cancelNotify(id)` | 撤掉一条还没弹的通知 |
| `AppShell.copy(text)` | 复制到剪贴板(**只有写,没有读**) |
| `AppShell.deviceId()` | 设备标识。**不是永久的,也不是账号** |
| `AppShell.requestReview()` | 请求系统弹评分窗。**弹不出来是正常的** |
| `AppShell.haptic(kind)` | 震一下。`light`(默认)/`medium`/`heavy`/`success`/`warning`/`error`/`select`。**永不失败,不用 catch** |
| `AppShell.reconnect()` | 立刻刷新。网络恢复后壳会自动刷一次,这是给你手动触发用的 |
| `AppShell.listen(plugin, event, cb)` | 注册原生插件事件。**网站自己要监听原生事件时用这个,别直接用 `Capacitor.addListener`** —— 见下 |

> **为什么要 `AppShell.listen`**(真机测出来的):Capacitor 每次页面开始加载时会
> 清空所有原生监听(`BridgeWebViewClient.onPageStarted` → `bridge.reset()`),
> 指望新页面重新注册。但**后退导航**时页面从缓存秒开,脚本注册完了 reset 才到,
> 刚注册的就被清掉 —— 后退过一次之后监听**静默失效**,没有任何报错。
> `AppShell.listen` 会在页面加载完之后补注册(先 remove 再 add,不会重复)。
> 壳自己的返回键、深度链接、网络状态、推送监听都已经改用它了。
| `AppShell.offline.clear()` | 清 SW 缓存并注销,排查「页面不更新」 |
| `AppShell.push.register()` | 请求通知权限并注册(要先加载 `app-push.js`) |
| `AppShell.exit()` | 退出 app(Android) |

**能力要先探测再调**,因为能力是编译期开关决定的。`has()` 问的是 Capacitor
真实注入的插件列表(`PluginHeaders`),不是配置文件 —— 配置文件会和用户装的版本脱节,这个不会:

```js
if (AppShell.has('biometric')) {
  unlockWithBiometry();
} else {
  showPasswordForm();   // 降级,别提示「出错了」
}
```

**两层调用约定:**

| | 失败时 | 用在哪 |
|---|---|---|
| `call()` | 一律 `null` | 壳内部、不关心失败原因的地方 |
| `invoke()` | reject,带 `err.code` | 新增能力,需要区分失败原因 |

`err.code` 三种值:

| code | 意思 | 该怎么办 |
|---|---|---|
| `unsupported` | 这个能力没编进 app(开关关着,或用户装的是旧版壳) | 静默降级 |
| `nobridge` | 原生 bridge 不在(网站跳到了站外域名) | 静默降级 |
| `failed` | 插件自己报的错,原始错误在 `err.cause` | 可以提示用户重试 |

**「用户拒绝权限」不算错误。** 权限接口会正常 resolve 出一个 denied 状态,
所以 `invoke()` 能分清「没这个能力」和「有能力但用户不给权限」——
`call()` 把两种都变成 `null`,分不出来。这是加 `invoke()` 的唯一理由。

```js
AppShell.invoke('Media', 'savePhoto', { path: imageUrl }).then(function () {
  AppShell.toast('已保存到相册');
}).catch(function (e) {
  if (e.code === 'unsupported') hideSaveButton();
  else AppShell.toast('保存失败,再试一次');
});
```

> 加了新接口就把 `app-shell.js` 里的 `SHELL_VERSION` 加一,并同步改这张表。
> `npm run verify` 会检查导出里有没有 `version` / `invoke` / `has` / `capabilities`。

### 原生能力开关

`app.config.json` 的 `capabilities` 决定壳带哪些原生能力,**默认全关**:

```json
"capabilities": {
  "scanner": false,
  "biometric": false,
  "saveToAlbum": false,
  "localNotifications": false,
  "clipboard": false,
  "deviceId": false,
  "inAppReview": false
}
```

开关做三件事,**它不装插件**:

1. 开的时候往 `AndroidManifest.xml` 和 `Info.plist` 写权限和用途字符串
2. 需要的时候**把插件自己塞进来的权限撤掉**(`tools:node="remove"`,目前只有本地通知要,原因见下)
3. 关的时候清干净 —— 关回去之后两个文件**字节级回到原样**(和 `enablePushNotifications` 同一个机制)

> 有三个开关(`clipboard` / `deviceId` / `inAppReview`)什么权限都不声明,
> 因为这三个插件两端都不需要权限。那它们还要开关干什么?一是记录意图,
> 二是 `npm run verify` 会盯住「插件装了但开关没开」这个危险状态 ——
> 插件只要装了就编进 app,XSS 的影响面就已经扩大了。

插件要自己 `npm install`,包名在 `scripts/capabilities.mjs` 里。
开关开了但插件没装,`npm run verify` 会告诉你装哪个。

| 开关 | 要装的插件 | 它会声明什么 |
|---|---|---|
| `scanner` | `@capacitor-mlkit/barcode-scanning` | Android `CAMERA` + iOS `NSCameraUsageDescription`。**本项目没开**,原因见下面「为什么没开扫码」 |
| `biometric` | `@aparajita/capacitor-biometric-auth` | iOS `NSFaceIDUsageDescription`(少了是直接崩,不是报错) |
| `saveToAlbum` | `@capacitor-community/media` | iOS `NSPhotoLibraryAddUsageDescription`(只写不读) |
| `localNotifications` | `@capacitor/local-notifications` | 复用已有的 `POST_NOTIFICATIONS`,**并撤掉插件塞进来的 `SCHEDULE_EXACT_ALARM`**(见下) |
| `clipboard` | `@capacitor/clipboard` | 什么都不声明(写剪贴板不需要权限) |
| `deviceId` | `@capacitor/device` | 什么都不声明。但**要写进 Play 的 Data safety** |
| `inAppReview` | `@capacitor-community/in-app-review` | 什么都不声明 |
| `haptics` | `@capacitor/haptics` | 什么都不声明。插件自带 `VIBRATE`(normal 权限,自动授予、不弹框、Data safety 不用填) |

> 生物识别**不要用 `capacitor-native-biometric`** —— 它依赖 `@capacitor/core ^3.4.3`,
> 最后一次发布是 2023-06,停在 Capacitor 3 时代。

> #### ⚠ 已知缺口:iOS 上的「拍照上传」
>
> 网页里的 `<input type="file" accept="image/*">` 在 iOS 上选「拍照」会**直接崩**,
> 因为 `Info.plist` 里没有 `NSCameraUsageDescription`(iOS 上碰相机缺用途字符串就是 crash)。
> 它随扫码开关一起被撤掉了,**这是有意识的决定**:现在没有上传图片的场景,
> 而声明用不到的权限审核会追问。
>
> **Android 不受影响**:Capacitor 在「没声明 CAMERA」时走系统相机 intent,
> 不需要自己的权限,反而更顺(`BridgeWebChromeClient.java:307-313`)。
> 所以这一条**只影响 iOS**。
>
> **你的站上一旦有上传图片的入口就必须补**。两种补法:
>
> 1. 临时验证:直接把 `NSCameraUsageDescription` 加进
>    `scripts/templates/Info.plist` 的受管区块外面
> 2. 正式做法:在 `scripts/capabilities.mjs` 里加一个开关(比如 `cameraUpload`),
>    `ios` 字段写 `{ NSCameraUsageDescription: '...' }`,`android` 留空,
>    `shellApi` 留空(这一项不需要网站侧接口,是 WebView 自带的)。
>    这样它和别的能力一样可开可关、关掉能清干净、`verify` 也会盯着。
>
> 文案要写清楚用途,比如「上传头像和评价图片时需要使用相机」。

**为什么默认全关**:在 WebView 里 XSS 不再只是网页 bug —— 注入的脚本能调用所有已装插件,
而这几项恰好是摄像头、相册、生物识别这类高价值目标。每开一个都要想清楚值不值,见「安全」一节。

#### 自定义 User-Agent

`app.config.json` 的 `appendUserAgent` 会追加到 WebView 的 User-Agent 末尾,两端都生效:

```json
"appendUserAgent": "WebViewApp/1.0"
```

服务器靠它分辨「这个请求来自 app」,可以据此隐藏「下载 App」横幅、走不同埋点、
给 app 用户不同的缓存策略。比在前端靠 `.in-app` class 判断可靠 ——
**那个只有页面渲染之后才知道,UA 是请求一发出去就带着的**。

留空就是完全不改 UA(`configure.mjs` 会把这个键整个拿掉,而不是追加一个空格)。

两条限制 `configure.mjs` 会挡住,因为它们只在真机上才看得出来:

- **只能 ASCII 可见字符** —— UA 头不允许中文,写了轻则被服务器丢掉,重则整个请求头坏掉
- **不超过 64 字符**

#### 自动重连

网络恢复之后壳会自动刷新一次,让用户看到最新内容而不是断网期间的缓存。

但**有未填完的东西时不刷** —— 在电商站上冲掉一个填了一半的收货地址,
比「内容稍微旧一点」严重得多。`app-shell.js` 的 `canReloadSafely()` 会检查四件事,
任何一条命中就只提示不刷新:

1. 光标正停在输入框里
2. 有被改动过的表单控件(和初始值不一样)
3. `contenteditable` 里有内容
4. 正在播放音视频

不想要这个行为就把 `CONFIG.autoReconnect` 改成 `false`,
网站想自己决定什么时候刷就调 `AppShell.reconnect()`。

> 断网兜底页(`errorPath` 那个)是**另一条路径**,它自己就会在网络恢复时跳回网站,
> 还带一个轮询兜底(有些安卓机不触发 `online` 事件)。两者不冲突:
> 兜底页管「页面压根没加载出来」,这里管「页面开着,中途断了又回来」。

**而且这是过审要求**:Info.plist 里声明了用途字符串却没有对应功能,Apple 会问这个权限干什么用;
Android 多一个权限,Google Play 的 Data safety 表格就要多填一条。开关把「声明权限」和
「真的用到」绑在一起,两边都省事。

### 这些能力怎么用

开关打开、插件装好之后,把 `app-capabilities.js` 也传到网站,放在 `app-shell.js` 之后:

```html
<script src="/app-shell.js" defer></script>
<script src="/app-capabilities.js" defer></script>
```

**每次调用前先 `has()`。** 用户手机里的 app 可能比网站旧好几个版本,
网站不能假设新能力一定在:

```js
// 生物识别 —— 用户取消也走 catch,那不是故障,别弹提示
if (!AppShell.has('biometric')) showPasswordForm();
AppShell.biometric.verify({ reason: '验证身份后查看订单' })
  .then(function () { unlock(); })
  .catch(function (e) { /* 用户取消或设备不支持 */ });

// 保存到相册
AppShell.saveImage(couponImageUrl, { fileName: 'coupon' })
  .then(function () { AppShell.toast('已保存到相册'); });

// 本地通知 —— 立刻弹,或者到点弹
if (AppShell.has('localNotifications')) {
  AppShell.notify({ title: '订单已发货', body: '点进来看物流' })
    .catch(function (e) {
      if (e.code === 'denied') { /* 用户不要通知,静默接受,别反复问 */ }
    });

  // 30 分钟后提醒回来结账;传同一个 id 再调一次就是替换,不会堆一串
  AppShell.notify({
    id: 9001,
    title: '购物车还有东西',
    body: '要不要回来看看?',
    at: new Date(Date.now() + 30 * 60 * 1000),
  });
  AppShell.cancelNotify(9001);   // 用户真的结账了,撤掉提醒
}

// 复制订单号 / 优惠码
AppShell.copy(orderNo).then(function () { AppShell.toast('订单号已复制'); });

// 评分弹窗 —— 在用户刚顺利完成一件事之后调
AppShell.requestReview();   // 没弹出来是正常的,别重试、别提示

// 触觉反馈 —— 用户能立刻感到「这不是网页」的那个信号
AppShell.haptic('light');     // 加入购物车
AppShell.haptic('success');   // 下单成功
AppShell.haptic('error');     // 优惠码无效
// 不用 catch:设备没马达、用户关了振动、静音模式,都只是什么都不发生,不是错误
```

几件必须知道的事:

| | 说明 |
|---|---|
| **生物识别不是登录** | 它只证明「手机的主人在场」,不证明身份。真正的登录态必须服务器签发、绑设备、可吊销、有有效期。注入的脚本也能触发一次解锁,所以**服务器侧必须二次校验** |
| **相册在 Android 要指定相册** | `savePhoto` 的 `albumIdentifier` 在 Android 上必填。`app-capabilities.js` 会按 `CONFIG.albumName` 自动找/建一个,**记得把它改成你的 app 名** |
| **Android 上卸载 app 会删掉存过的图** | 真机实测:图存进 `Android/media/<包名>/<相册名>/`,是 app 自己的媒体目录。系统相册里看得到,但卸载时一起删。插件写死的(`getExternalMediaDirs()[0]`),没得选。好处是不用存储权限。用户要永久保留的东西(发票、凭证)别只靠这个 |
| **生物识别的方法名是 `internalAuthenticate`** | 不是 `authenticate`。后者只在插件 JS 包装层里,`invoke()` 绕过包装层,调它会**静默挂死**(不报错,Promise 永远不返回)。`verify` 现在会读插件源码挡住这类错误 |
| **本地通知不是推送** | 它是这台手机自己排的,服务器发不了。服务器要主动找用户得走推送(`app-push.js`)。它的用处是「app 里发生了什么,过一会儿提醒用户回来」,不需要任何服务器 |
| **通知频道的名字用户看得见** | 插件兜底频道就叫「Default」,会出现在系统设置里。`app-capabilities.js` 的 `CONFIG.notifyChannel` 自己建了一个,**改成你的业务分类**(「订单状态」「优惠提醒」)。频道建好后名字不能再用代码改,要改得连 `id` 一起换 |
| **剪贴板只有写** | 插件有 `read()`,但**刻意没暴露**。读剪贴板能拿到用户在别处复制的密码和验证码,而 WebView 里的 XSS 就能调它;iOS 还会弹「xxx 粘贴自 yyy」。要读就让用户自己粘贴 |
| **设备 ID 不是永久的** | Android 卸载重装会变,iOS 上同厂商 app 全部卸载后也会变。能当设备偏好、风控信号,**不能替代登录**,也不能做跨 app 追踪。用了要写进 Play 的 Data safety |
| **评分弹窗弹不出来是正常的** | 两端系统都有频率限制(iOS 一年最多 3 次),而且 API 不告诉你弹没弹。不要重试、不要提示用户、不要据此判断用户评没评。别在用户刚失败完一单时调 |

#### 本地通知:一个会挡住发版的权限

`@capacitor/local-notifications` 在**它自己的库 manifest** 里声明了四个权限,
Gradle 合并进 app 的时候**无条件**带上,我们的开关管不到别人的 manifest:

| 权限 | 怎么处理 |
|---|---|
| `POST_NOTIFICATIONS` | 本来就有(下载进度通知要用) |
| `RECEIVE_BOOT_COMPLETED` | **留着**。重启后恢复已排期的通知要用,普通权限 |
| `WAKE_LOCK` | **留着**。同上,普通权限 |
| `SCHEDULE_EXACT_ALARM` | **撤掉** |

**为什么必须撤 `SCHEDULE_EXACT_ALARM`**:Android 官方文档写得很直接 —— 不符合政策的 app
**没法带着这个权限发版**。要符合,得有闹钟、日历那种以「精确到分秒」为核心功能的场景;
一个商城 app 不符合。而且 Android 14+ 这个权限默认就是拒绝的,留着也换不来精确定时,
净剩一个发版风险。

**撤掉会不会把通知弄坏?不会。** 插件的 `setExactIfPossible()` 先问
`canScheduleExactAlarms()`,不允许就退回 `alarmManager.set()`(非精确),只打一条
warn 日志,不抛异常 —— 这是读 `LocalNotificationManager.kt:350-375` 确认的。
购物车提醒这类场景差几分钟无所谓。

`app-capabilities.js` 调用时还会显式传 `isExactNotification: false`
(这个选项默认是 `true`),免得每弹一条就刷一次警告日志。

撤的办法是 `tools:node="remove"`,`configure.mjs` 连 `xmlns:tools` 命名空间一起管 ——
**所以关掉开关之后 Manifest 还是字节级回到原样**(实测 `git diff` 为空)。
`npm run verify` 两个方向都会检查。

> `npm run verify` 还会提醒**通知小图标**:不配的话插件兜底用
> `android.R.drawable.ic_dialog_info`,就是系统那个蓝色感叹号,在状态栏里像出错了。
> 本项目放了一个 `res/drawable/ic_stat_notify.xml`(一个铃铛)。
> 小图标必须是**纯白剪影 + 透明背景**,系统只取 alpha 通道然后自己上色 ——
> 直接拿 app 图标当小图标会变成一个白方块。换成你自己标志的剪影更好。

#### 为什么没开扫码

扫码是做过的(完整实现在 commit `3634166`,要用从 git 里取回就行),实测之后又去掉了。
两个原因:

**它在 iOS 上根本不存在。** `@capacitor-mlkit/barcode-scanning` 没有 `Package.swift`,
而本项目 iOS 用 SPM(见「已知坑」第 3 条)—— SPM 不收它,所以 iOS 上 `has('scanner')`
永远是 `false`。**而 Apple 4.2 看的正好是 iOS**,所以它对过审的贡献是零。

**它一个人就占 9.2 MiB。** 三个数都是 CI 上的真实 debug APK:

```
 5,363,610 字节   一个能力插件都没装
19,142,295 字节   三个能力插件全装              (+13.1 MiB)
 9,480,634 字节   去掉扫码,留生物识别 + 相册    (-9.2 MiB)
```

所以那 13MB 不是扫码一个人的账:**扫码自己 9.2 MiB,生物识别 + 保存到相册
合起来 3.9 MiB**。留下的两项两端都可用、都算 4.2,3.9MB 花得值;
扫码那 9.2MB 换来的是一个 iOS 上根本不存在的能力。

它这么大是因为插件把两条路都拉进来了:

```
com.google.mlkit:barcode-scanning                  ← 打包进 app 的离线模型(13MB 的大头)
com.google.android.gms:play-services-code-scanner  ← 我们实际走的按需下载那条
+ androidx.camera core/camera2/lifecycle/view
```

把离线模型 exclude 掉会让插件模块自己编译不过,所以这不是配置能省掉的。
(这几个数是 debug APK —— 没过 R8,release AAB 会小一些,但三者的差值不会变。)

**什么时候该开**:你的业务里真的有扫码场景(门店核验、取货码、会员码),而且你接受
它只在 Android 上有。这时 13MB 换一个核心功能是值得的 —— 但别把它当成过审的筹码。

`npm run verify` 会把上面这些都盯住:插件名和真插件一致、开关和权限一致、
开了能力但插件没装、插件装了但开关没开、以及**哪些能力只在 Android 上有**。

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

> **Android 上 `download="文件名"` 里的文件名不生效**(真机实测)。原生的
> `onDownloadStart` 只拿得到 URL、`Content-Disposition` 和 MIME 类型,拿不到 HTML 属性。
> 文件名由 `URLUtil.guessFileName` 从这几样推出来。**要控制文件名,让服务器发
> `Content-Disposition: attachment; filename="订单-123.pdf"`** —— 这在 iOS 上也更可靠。

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

> **`cover` 在 Android 上还有一个前提:系统 WebView 主版本 >= 140。**
> `SystemBars` 的透传分支要求 `getWebViewMajorVersion() >= 140` 且 viewport 里
> 确实有 `viewport-fit=cover`(`SystemBars.java:193`)。WebView 更老的机器会走回
> `native` 那条分支:注入的变量是 0,内容不会被挡(decorView 仍然有 padding),
> 但「内容铺到屏幕边缘」的效果拿不到。所以 `cover` 要按机型验,别假定它一定生效。

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

还有一个变量 `--app-bottom-inset`:app 自己加在底部的栏占了多高。
`app-tabbar.js` 建好 Tab 栏之后会把它设成栏高(内联在 `<html>` 上),
`app-shell.js` 的提示条据此自动往上让,不会压在 Tab 栏上面。
**如果网站有自己的固定底栏**(而且没用 `app-tabbar.js`),把它设上,
提示条也会跟着让开:

```css
.in-app { --app-bottom-inset: 56px; }   /* 你自己底栏的高度,不含 safe area */
```

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

### 强制更新提示

版本太旧时显示一个**不可关闭**的全屏遮罩,只留"去更新"一条出路。

**做在原生侧,不是网页侧** —— WebView 自己崩了、或者网站整个打不开的时候,
网页里的提示也显示不出来,而"版本太旧导致前后端对不上"恰恰经常以这种形式表现。

#### 怎么开

1. 把 `website/app-version.json` 放到网站上(或者用任何能返回同样 JSON 的接口)
2. `app.config.json` 的 `updateCheckUrl` 填它的地址,**必须 https**
3. `npm run sync`

接口格式:

```json
{
  "android": { "minVersionCode": 12, "storeUrl": "https://play.google.com/store/apps/details?id=..." },
  "ios":     { "minVersion": "1.2.0", "storeUrl": "https://apps.apple.com/app/id..." },
  "message": "这个版本太旧了,请更新后继续使用。"
}
```

- `android.minVersionCode` 对的是 Android 的 `versionCode`(CI 里用 `github.run_number`)
- `ios.minVersion` 对的是 iOS 的 `CFBundleShortVersionString`(`1.2.0` 这种)。
  按点分段逐段比数字,所以 `1.10.0` 比 `1.9.0` **新**(不是字符串比较)
- `storeUrl` 放在接口里而不是编译进 app,这样上架后拿到真实商店链接不用重新发版
- `updateCheckUrl` 留空就是关闭,两端原生代码第一行就 return

#### 一个刻意的设计:失败就什么都不做

拿不到、解析不了、字段缺失、超时(8 秒)、不是 https —— **任何一种情况都什么都不做**。
一个会因为接口挂了就把用户锁在遮罩后面的强制更新,比没有强制更新糟得多。

遮罩挡住的东西也都考虑了:Android 的返回键(注册一个什么都不做的
`OnBackPressedCallback`,最后注册的优先级最高,会盖住 App 插件那个)、
iOS 的侧滑返回(`allowsBackForwardNavigationGestures = false`)。
两边遮罩都是不透明背景 + 吃掉触摸事件。

#### 发版时怎么用

正常发版**不要**动 `minVersionCode` / `minVersion` —— 只有在"旧版本会出错"的时候才抬,
比如接口改了不兼容、或者修了一个数据会出问题的 bug。抬了之后旧版本用户在更新前
完全用不了 app,这是很重的手段。

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

### 调试包也用固定签名(可选,真机测试时省事)

不配的话,CI 每次都随机生成一把 debug 签名:新的调试包装不上去
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`),只能先卸载 —— 会清掉 app 数据和
「保存到相册」存的图。配一个 secret 就固定下来:

```bash
keytool -genkeypair -keystore debug.keystore -storetype PKCS12 \
  -alias androiddebugkey -storepass android -keypass android \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
base64 -w 0 debug.keystore | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64
```

- 密码和别名**必须**是上面这两个(`android` / `androiddebugkey`),`build.gradle` 里写死的。
- 它只签调试包,跟上架用的 release keystore 无关。
- CI 日志的「核对 APK 的签名证书」一步会打出包里实际的证书 SHA-256,
  两次构建应该一样。**别只看 keystore 的指纹**:第一版就是 keystore 指纹对了、
  Gradle 却没用它(放在 `~/.android/debug.keystore` 在 CI 上不生效),
  现在改成由 `ANDROID_DEBUG_KEYSTORE_FILE` 显式指定。
- 这个项目已经配好了,keystore 的本机副本在 `~/.android/debug.keystore`。

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

#### 本项目为这条做了什么

| 做法 | 算不算"Safari 做不到" | 在哪 |
|---|---|---|
| **离线阅读** | ✅ 算。审核员真的会开飞行模式试 | `website/sw.js`,由 `app-shell.js` 只在 app 里注册 |
| **生物识别** | ✅ 算。而且两端都真的可用 | `capabilities.biometric` + `website/app-capabilities.js` |
| **保存到相册** | ✅ 算。而且两端都真的可用 | `capabilities.saveToAlbum` + `website/app-capabilities.js` |
| **原生底部 Tab 栏** | ❌ 不算能力,但是审核员第一眼的"这不是网页"信号 | `website/app-tabbar.js` |
| 推送 | ❌ Apple 点名说光有推送不够 | 第七节 |
| 深度链接 | ❌ 不算,但是加分项 | 第二节 |

所以组合是「三个真能力 + 一层观感」,三个在 iOS 上都真的在。**只做 Tab 栏不够。**

还想再加的话,先问一句业务里到底有没有这个场景 —— 别硬加业务里不存在的功能,
审核员看得出来;而且每加一个都要付包体和 XSS 影响面的代价(扫码那 9.2MB 就是
现成的例子,见「为什么没开扫码」)。

#### 离线阅读

把 `website/sw.js` 放到网站**根目录**(`/sw.js`,否则拿不到 `/` 作用域)。
`app-shell.js` 的 `CONFIG.offlineCache` 默认开,会在页面 load 之后注册它。

**它只在 app 里注册**,浏览器访问你的网站不会注册这个 SW —— 一个写坏的 SW
能把整个线上站搞挂,所以这是刻意的。app 的 WebView 有自己独立的存储,
和用户浏览器里的注册互不干扰。

策略:

| 请求 | 策略 | 理由 |
|---|---|---|
| HTML 页面 | **网络优先**,失败才用缓存 | 电商站的价格和库存不能给缓存版本 |
| css/js/字体/图片 | 缓存优先,后台顺手更新,上限 80 条 | 这些不常变 |
| `/api`、`/cart`、`/checkout`、`/account`、`/login`、`wp-admin` | **一律不缓存** | 缓存这些会出真事故 |
| 跨域、POST、带 Range 的媒体 | 不碰 | |

**改 `sw.js` 之前先读它的文件头。** 里面有一条是读 Capacitor 源码定下来的硬规则:
Android 上原生 bridge 不是靠 WKUserScript 注入的,而是**代理 HTML 请求、把
bridge JS 内联插进 `<head>`**(`WebViewLocalServer.handleProxyRequest` →
`JSInjector.getInjectedStream`),而且**只在请求的 `Accept` 头包含 `text/html`
时才注入**。所以 SW 里 `fetch` 必须传原始的 `request` 对象,传 `request.url`
会新建一个 `Accept: */*` 的请求 → Android 不注入 bridge → 缓存下来的 HTML 里
没有 `window.Capacitor` → 离线打开那页时 `app-shell.js` 整个失效。

还有一点:SW 一旦接管了导航请求,原生层就看不到"主框架加载失败",
`errorPath`(自定义离线页)**不会触发**。所以 `sw.js` 自己返回一个兜底页。

排查"页面怎么不更新"用 `AppShell.offline.clear()`,清缓存并注销。
改了缓存策略记得把 `sw.js` 里的 `VERSION` 加一。

#### 底部 Tab 栏

把 `website/app-tabbar.js` 放到网站上,**在 `app-shell.js` 之后**引用。
然后**必须改文件开头的 `ITEMS`**,href 和文字都要是你站上真实存在的页面 ——
指向死链比没有 Tab 栏更糟。

它会给 `<html>` 加 `in-app-tabbar` class 并给 body 留出底部空间,
safe area 用的是 `--app-safe-bottom`,所以 `native` 和 `cover` 两种模式都对。
同时它会把栏高写进 `--app-bottom-inset`,这样 `app-shell.js` 的提示条
(「再按一次退出」、断网提示、下载提示)会落在 Tab 栏上方而不是压住它。
结算流程下默认不显示(`CONFIG.hideOn`)。

#### 还要你自己做的「去网页化」

这几条成本低、效果直接,选择器只有你知道,所以没法替你写:

```css
/* 在 app 里隐藏这些 —— 选择器换成你网站的 */
.in-app .site-header-nav,      /* 网站自己的顶部导航,Tab 栏已经替代了 */
.in-app .breadcrumb,
.in-app .site-footer-links,    /* 页脚那一堆链接 */
.in-app .cookie-banner,
.in-app .app-download-banner { /* "下载我们的 App" 横幅 */
  display: none !important;
}
```

- **别有死链和半成品页**。审核员十来分钟就在找这些
- **图标和启动页必须换掉占位图**(`npm run verify` 会一直提醒),否则容易撞 4.3(a)
- App Store 截图用真实页面
- 要登录才能用的话,**一定要在 App Review Notes 里给测试账号**。
  即使不用登录,如果下单过程中有手机验证码之类的门,也要写清楚怎么走完一单 ——
  审核员走不到支付就会判"功能不完整"
- **卖数字商品或订阅的话必须走 IAP**(Guideline 3.1.1),用自己的支付链路必拒。
  卖实物商品不受这条限制

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
  app-tabbar.js          ← 底部 Tab 栏,ITEMS 必须改成你站上的页面(见第六节)
  sw.js                  ← 离线缓存,必须放网站【根目录】(见第六节)
  app-version.json       ← 强制更新的版本接口,要开才需要(见第二节)
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
