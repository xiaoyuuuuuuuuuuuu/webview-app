# 真机测试怎么做

这份是**操作手册**:怎么把包装到手机上、按什么顺序点、正确结果长什么样、
出问题怎么把信息捞出来。

当前测试配置指向的是 GitHub Pages 上的测试站,不是你的真站:

```
siteUrl   https://xiaoyuuuuuuuuuuuu.github.io/webview-app/index.html
appId     io.github.xiaoyuuuuuuuuuuuu.testing
appName   testing
```

---

## 0. 先搞清楚现在能测什么

**别在测不了的项目上浪费时间。**

| 项目 | 现在能测吗 | 为什么 |
|---|---|---|
| 装得上、打得开、加载进度条 | ✅ | |
| 启动页、状态栏颜色、app 名和图标 | ✅ | 图标还是占位图;启动页头 2 秒的状态栏有已知问题,见第 6 节 |
| 原生底部 Tab 栏、页面间跳转 | ✅ | |
| safe area(刘海/手势条) | ✅ | `native` 模式下四个值应该全是 0 |
| **生物识别** | ✅ | 两端 |
| **保存到相册** | ✅ | 两端 |
| **本地通知**(含定时) | ✅ | 两端 |
| **剪贴板(只写)** | ✅ | 两端 |
| **设备 ID** | ✅ | 两端 |
| **评分弹窗** | ✅ | 弹不出来是正常的 |
| **触觉反馈** | ✅ | iOS 模拟器没感觉,真机才有 |
| **自动重连** | ✅ | 开飞行模式再关,页面应该自动刷一次 |
| **自定义 User-Agent** | ✅ | 诊断页最下面那行 UA 结尾应该有 `WebViewApp/1.0` |
| 离线阅读(Service Worker) | ✅ | 作用域只限 `/webview-app/` |
| 下载 | ✅ | iOS 走应用内浏览器 |
| 外链分流 | ✅ | |
| 支付跳转(`intent://`) | ✅ Android | 下载页第 5 节。iOS 上没反应是正常的,支付网关在 iOS 不给这种链接 |
| Android 返回键 / 双击退出 | ✅ | |
| 下拉刷新 | ✅ | |
| **扫码** | ❌ | 本项目有意关掉了。点那个按钮应该回 `unsupported` |
| **深度链接 / Universal Links** | ❌ | 两个原因叠在一起:`.well-known` 必须在**域名根目录**,而测试站在 `/webview-app/` 子路径下;而且免费签名的包没有 `associated-domains`。要等你的真域名 |
| **推送通知** | ❌ | 要 Firebase 凭据 + 你自己的服务器 |
| **强制更新** | ❌ | `updateCheckUrl` 是空的(默认关闭) |
| **iOS 上的「拍照上传」** | ⚠ **别测,会崩** | 见下面的「已知缺口」 |

> ### ⚠ 已知缺口:iOS 上网页里的「拍照上传」会崩
>
> 网页里的 `<input type="file" accept="image/*">`,在 iOS 上选「拍照」那一项会
> **直接崩溃**(不是报错)。原因是 `Info.plist` 里没有 `NSCameraUsageDescription` ——
> iOS 上任何走到相机的操作缺了用途字符串都是 crash,这是系统行为。
>
> 它是去掉扫码时被一起撤掉的(扫码的开关负责声明它)。
> **这是有意识的决定,不是忘了**:现在的测试站没有上传图片的地方,
> 而声明一个用不到的权限会在审核时被追问。
>
> **Android 不受影响**,而且相反:实测 Capacitor 的 `isMediaCaptureSupported()`
> 在「没有声明 CAMERA 权限」时返回 true(走系统相机 app 的 intent,
> 不需要自己的权限),所以 Android 上不声明反而更顺
> (`BridgeWebChromeClient.java:307-313`)。
>
> **什么时候必须补**:你的真站上出现任何「上传图片」的入口(头像、评价晒图、
> 退货凭证、客服发图)。
>
> **补法**:`app.config.json` 的 `capabilities.cameraUpload` 改成 `true`,
> `npm run sync`。只加 iOS 的用途字符串,不装插件、不动 Android。
> 打开之后这一项就可以测了。没打开之前,iOS 用户点到那个按钮就是崩。

---

## 1. Android:装包

APK 已经发给你了,也可以自己下:
**Actions → Android → 最近一次成功的运行 → 底部 Artifacts → `app-debug-apk`**
(下下来是个 zip,解压出 `app-debug.apk`)

### 办法 A:直接传到手机(最简单)

1. 用微信/QQ/网盘/数据线把 `app-debug.apk` 传到手机
2. 用手机的文件管理器点它
3. 系统会拦一下,提示「不允许安装未知应用」→ 点**设置** → 允许这个来源 → 返回继续装

> 国产 ROM(小米/华为/OPPO/vivo)可能还会多两道:
> 「安装前检测」「风险应用」之类的确认框,还有的要先关「纯净模式」。
> 这些都是系统的,和包本身没关系。

### 办法 B:用 adb(要装 Android 平台工具)

手机上先开「开发者选项 → USB 调试」,连上数据线:

```powershell
adb install -r app-debug.apk
```

装好后桌面上会出现一个叫 **testing** 的图标。

> **以后出的新包直接覆盖安装就行**,不用先卸载:CI 的调试包用的是同一把固定签名
> (仓库 secret `ANDROID_DEBUG_KEYSTORE_BASE64`,见 README「四、Android 签名和上架」)。
> 例外:2026-11-27 下午之前出的包是随机签名的,手机上装的是那种的话,要先卸载一次。
> 依据:两次独立构建的 APK 证书 SHA-256 一致(`b0db84…c105`,CI 日志「核对 APK 的签名证书」);
> 真机上「新包直接覆盖旧包」这一步还没实际跑过。

---

## 2. iOS:装包(三条路,按你的情况挑)

iOS 和 Android 最大的不同:**没签名的包装不上去**。所以先看你属于哪种。

### 路 A:有付费 Apple 开发者账号($99/年)→ TestFlight(最顺)

CI 里已经写好了,只要配 4 个 secret。
**Settings → Secrets and variables → Actions**:

| secret | 哪来的 |
|---|---|
| `APPLE_API_KEY_P8` | App Store Connect → 用户和访问 → 密钥 → 新建,下载的 `.p8` **全文** |
| `APPLE_API_KEY_ID` | 同一页上那个 Key ID |
| `APPLE_API_ISSUER_ID` | 同一页顶部的 Issuer ID |
| `APPLE_TEAM_ID` | 开发者后台右上角那 10 位 |

然后 **Actions → iOS → Run workflow**,把 `upload` 勾上。

⚠ **配之前先去开发者后台**给 App ID `io.github.xiaoyuuuuuuuuuuuu.testing`
打开 **Associated Domains**。不开的话 provisioning profile 对不上,
签名构建会直接失败(无证书的编译验证不受影响)。

### 路 B:只有免费 Apple ID → Sideloadly 自己重签 ← **你走这条**

CI 会产出一个**未签名 IPA**:
**Actions → iOS → 最近一次运行 → Artifacts → `app-ios-unsigned-ipa`**

> 这个 IPA 拆开核过了:`Payload/App.app/App` 可执行文件在,Capacitor 和 Cordova
> 两个 framework 都在,**没有 `_CodeSignature`、没有 `embedded.mobileprovision`** ——
> 这正是 Sideloadly 想要的输入,它自己重签。

#### 准备

1. 装 [Sideloadly](https://sideloadly.io/)
2. 装 Apple 的 **iTunes** —— 要的是里面的**设备驱动**。
   **必须装 apple.com 下载的那个版本,不要装 Microsoft Store 版**,
   Store 版不带驱动,Sideloadly 会认不到手机
3. iPhone 用数据线连电脑,手机上点「**信任此电脑**」并输密码

#### 装

4. 把 `App-unsigned.ipa` 拖进 Sideloadly,填你的免费 Apple ID,点 Start
   - 账号开了两步验证的话,它会要一个验证码,照着手机上弹的填
   - 装的过程中它会去 Apple 那边注册一个 App ID,正常要几十秒

#### 装完还有两步,少一步就打不开

5. **信任证书**:设置 → 通用 → **VPN与设备管理** → 点你的 Apple ID → **信任**。
   不做这一步,点图标会提示「不受信任的开发者」
6. **开启开发者模式**(iOS 16 及以上必须):
   设置 → **隐私与安全性** → 拉到最下面 → **开发者模式** → 打开 → **重启手机** →
   重启后会再确认一次

   > **这一步最容易卡住。** iOS 16 之前没有这个开关,所以很多教程里没写。
   > 症状是:装是装上了,图标也在,但点开闪退或者直接没反应。

#### 免费账号的限制,这些都**不是 bug**

| | |
|---|---|
| **7 天到期** | 过期后 app 打不开,重新 sideload 一次即可。**测试期间尽量一次测完** |
| 同时最多 3 个自签 app | 超了要先删掉别的 |
| 每周能注册的 App ID 有限 | 反复重装同一个包不受影响 |
| 深度链接不生效 | 未签名 IPA 里**本来就没有任何 entitlement**(没签名就没有 entitlements 段 —— 实测核对过),Sideloadly 用免费 profile 自己的那套签。所以 `associated-domains` 压根不存在。反正测试站也测不了深度链接,见第 0 节 |
| 评分弹窗弹不出来 | 非 App Store 渠道装的包本来就基本弹不出来 |

**其余五项能力不受免费签名影响**:生物识别(LocalAuthentication)、保存到相册、
本地通知、剪贴板、设备 ID 都不需要特殊 entitlement,只要 Info.plist 里的用途字符串,
那两条已经在包里了(实测核对过)。

### 路 C:手边有 Mac → Xcode 直接跑

`git clone` 之后 `npm install && npm run sync`,用 Xcode 打开
`ios/App/App.xcodeproj`,Signing 里选你的免费 Apple ID,连上手机点运行。
同样是 7 天到期。

---

## 3. 装好之后,按这个顺序点

打开 app,底部应该出现**原生 Tab 栏**四格:**诊断 / 能力 / 离线 / 下载**。

### 第 1 站:诊断页

这一页只读不写,先确认壳本身是好的。

| 看什么 | 正确结果 |
|---|---|
| `AppShell.version` | `1.2.0` |
| `AppShell.platform` | `android` 或 `ios` |
| 能力表里的 `scanner` | **不在**(有意关掉的) |
| 能力表里其余六项 | 全部**在** |
| safe area 四个值 | **全是 0** —— `native` 模式下原生已经让开系统栏了,全 0 才对 |
| Service Worker | 第一次打开可能是「没有注册」,点去别的页再回来就有了 |

> **如果 `scanner` 显示「在」**,说明开关没关干净,告诉我。
> **如果六项里有「不在」的**,说明那个插件没编进这个包。

### 第 2 站:能力页 —— 六个按钮

每个按钮的结果都打在页面最下面的日志里,**失败会带 `err.code`**。

| 按钮 | 正确结果 | 要额外确认什么 |
|---|---|---|
| `check()` | 返回设备支持情况 | |
| `verify()` 弹验证 | 弹出 Face ID / 指纹框 | **按取消**也试一次 —— 应该走 catch 而不是崩 |
| 存这张图(网址) | 日志「成功」 | **去系统相册看图真的出现了**。Android 在叫 `testing` 的相册里 |
| 存一张 data: 图 | 同上 | 这个走的是另一条输入路径(base64) |
| 立刻弹一条 | 通知栏出现 | 首次会先弹通知权限;**点通知应该回到 app** |
| 10 秒后弹 | 10 秒后出现 | 点完**把 app 切到后台**。可能晚几秒到几分钟 —— 见下面的注 |
| 取消 id 9001 | 日志「成功」 | 排完 10 秒那条后立刻点,通知应该不再出现 |
| 复制 | 日志「成功」 | **去别的 app 的输入框长按粘贴**,看内容对不对 |
| 读一下(设备 ID) | 出一串字符 | |
| 请求评分 | 日志「已调用」 | **什么都没弹是正常的**,别重试 |
| 试着调扫码 | `AppShell.scan` 不存在 + `unsupported` | 这是在验「关掉的能力会不会优雅降级」 |

> **关于「10 秒后弹」会晚**:我们**刻意**撤掉了精确闹钟权限
> (`SCHEDULE_EXACT_ALARM`)—— Android 官方文档写明,不符合政策的 app
> 带着它**没法在 Google Play 发版**,而商城 app 不符合。
> 插件会自动退回非精确闹钟,所以系统可能攒着一起发。**晚到是预期行为**。
> 只有「压根不弹」才是问题。

### 第 3 站:离线页 —— 4.2 的重头戏

审核员真的会开飞行模式试这一项,所以这是最值得认真测的。

1. 先把四个页都点一遍(让 SW 缓存下来)
2. 确认这一页显示「这一页由 SW 控制」
3. 开**飞行模式**
4. **把 app 完全退掉**(从后台划掉),再重新打开

**期望**:还能看到页面,而不是「无法连接」。

> 联网时你看到的永远是最新内容 —— 因为 HTML 是**网络优先**的
> (商城的价格和库存不能给缓存版本)。所以「缓存有没有生效」**只能断网才看得出来**。

### 第 4 站:下载页

| 测什么 | Android 期望 | iOS 期望 |
|---|---|---|
| 带 `download` 属性的链接 | 通知栏出现下载进度,完成后在「下载」里找得到 | 弹出 Safari 视图,可以「存到文件」 |
| 只靠扩展名的链接 | 同上 | 同上 |
| 路径里没扩展名的 | **不触发下载**(这是规则的边界,不是 bug) | 同上 |
| 站外链接 | 打开应用内浏览器(有「完成」按钮),**不该把你挤出 app** | 同上 |
| ⑤-① `intent://` 已安装的 app | 直接跳进 Google 地图(没装就去 Play 商店它的页面) | 没反应(正常) |
| ⑤-② 没装的钱包 + 备用网址 | **回到下载页第 5 节,还在 app 里**,顶上出现绿色提示 | 没反应(正常) |
| ⑤-③ 没装 TNG eWallet | 跳到 Play 商店的 TNG eWallet 页面(装了就直接打开 TNG) | 没反应(正常) |

> ⑤ 这一节测的是支付跳转。改之前三个按钮在 Android 上都是**点了完全没反应**,
> 这正是电商结账里最糟的那种失败。原因见 README「支付跳转」一节。

### 第 5 站:壳本身的几个动作

| 动作 | 期望 |
|---|---|
| 页面里下拉 | 出现刷新图标,松手刷新 |
| Android 返回键(在子页) | 回到上一页 |
| Android 返回键(在首页) | 提示「再按一次退出」,再按才退 |
| 转屏 | 进度条和 Tab 栏跟着变,不错位 |
| 杀掉 app 重开 | 正常回到首页 |

---

## 4. 出问题怎么把信息给我

**第一选择:页面里的日志区。** 测试页所有结果都打在那儿,
直接截图或者把那几行抄给我就行 —— 里面有 `err.code` 和插件的原始错误,
这通常够定位了。

**第二选择:看 console。** 有些东西只在 console 里,比如
`[app-shell] Service Worker 注册失败` 那条警告。

**debug 包直接就能连**,不用改任何配置:

1. 手机开「开发者选项 → USB 调试」,连上数据线
2. 电脑 Chrome 打开 `chrome://inspect`
3. 列表里会出现 `testing` 的 WebView,点 **inspect**

打开的就是标准 DevTools:Console 看日志、Network 看请求、
Application → Service Workers 看 SW 注册情况。

> **为什么 debug 能连而上架的包不能。** `capacitor.config.ts` 里【刻意没有】
> `webContentsDebuggingEnabled` 这个键。Capacitor 的默认值就是
> 「这个包可调试吗」(`CapConfig.java:286`,取 `FLAG_DEBUGGABLE`),
> 所以 debug 包自动开着、release 包自动关着 —— 正好是我们要的。
>
> 注意**只要这个键出现在配置里,显式值就会盖掉那个默认行为**。
> 所以别为了「更安全」在那儿写一个 `false`:那样连 debug 包的调试口也一起堵死,
> 而 release 包本来就不会开。(这个项目之前就是写死 `false` 的,已经改掉。)

`adb logcat` 也能看原生侧的日志,想看 Capacitor 自己那些:

```powershell
adb logcat -s Capacitor:V Capacitor/Console:V
```

iOS 那边要 Mac 上的 Safari → 开发 → 你的 iPhone。Windows 上没有对应的办法,
所以 iPhone 这边主要靠页面里的日志区。

---

## 5. 验收清单

抄一份勾着走。**一条都没跑过的时候,别说"应该没问题"。**

```
壳
[ ] 装得上、打得开,不白屏
[ ] 启动页正常收起
[ ] Android 12+:启动页是 splashBackground 的底色 + app 图标(不是 splash.png)
[ ] 深色模式下启动页颜色符合预期(没配 splashBackgroundDark 就是和浅色一样)
[ ] Android 内容页状态栏是 themeColor,图标看得清;app 开着时切深色模式也不变
[ ] 加载进度条从左走到右然后消失
[ ] 限速到 3G 时进度条明显可见
[ ] 缓存命中的页面(秒开)不闪进度条
[ ] 原生 Tab 栏四格都在,点哪格去哪页,当前页高亮
[ ] 转屏不错位
[ ] 下拉刷新可用
[ ] Android 返回键:子页返回 / 首页双击退出
[ ] iOS 侧滑返回可用
[ ] safe area 四个值在 native 模式下全是 0

能力
[ ] 生物识别:弹得出来
[ ] 生物识别:按取消不崩、走 catch
[ ] 保存到相册:系统相册里真的出现了图
[ ] 本地通知:权限弹窗出现
[ ] 本地通知:立刻弹的能弹出来
[ ] 本地通知:点通知回到 app
[ ] 本地通知:定时的最终会弹(晚到不算失败)
[ ] 本地通知:取消之后不再弹
[ ] 剪贴板:粘贴出来内容对
[ ] 设备 ID:读得到
[ ] 评分弹窗:调用不报错
[ ] 扫码:返回 unsupported 并优雅降级
[ ] 触觉反馈:七种都能感觉到(iOS 要真机)
[ ] User-Agent 结尾带 WebViewApp/1.0

自动重连
[ ] 开飞行模式 -> 关掉,页面自动刷新一次
[ ] 在输入框里打几个字不要提交,再开关飞行模式 -> 【不刷新】,只提示
[ ] 手动调 AppShell.reconnect() 能刷

离线(4.2 重点)
[ ] 联网时页面正常
[ ] 飞行模式 + 完全重启后仍能打开
[ ] 清缓存按钮可用

下载
[ ] 带 download 属性的能下
[ ] 靠扩展名的能下
[ ] 没扩展名的不触发(预期)
[ ] 站外链接不把人挤出 app

关键项(这几条挂了要先修)
[ ] 原生 bridge 还活着:诊断页能读到 AppShell.version
[ ] iOS:Xcode 日志里 "Loading app at" 只出现一次(出现两次要改 storyboard 的 customClass)
```

---

## 6. 真机实测结果(2026-11-27)

**设备**:TECNO SPARK Go 2024(BG6),Android 13 / API 33,arm64。
**方法**:adb 装包,把 WebView 的 DevTools socket 转发出来,用 CDP 的
`Runtime.evaluate` 直接在页面里调 `AppShell.*`,拿**真实返回值**;副作用再去
系统里核对(`dumpsys notification` / `dumpsys alarm` / MediaStore / 文件系统)。
不是看屏幕猜的。

### 通过

| 项目 | 实测证据 |
|---|---|
| 18 个插件全部注册,`BarcodeScanner` 不在 | `logcat` 的 `Registering plugin instance` |
| `AppShell.version` / `platform` | `1.3.0` / `android` |
| safe area | 四个值全 0(`native` 模式正确) |
| Tab 栏发布高度 | `--app-bottom-inset: 52px` |
| User-Agent | 结尾 `... Mobile Safari/537.36 WebViewApp/1.0` |
| 设备 ID | `d6631a73698b98da` |
| 剪贴板 | 写进去用插件的 `read` 读回来一致(只做验证,仍然不对网站暴露读) |
| 触觉反馈 | 七档调用都 resolve。**手感要人判断** |
| 本地通知 · 立刻 | 系统里 `channel=general`(自建频道,不是兜底的 "Default")、`color=0xff1565c0`(themeColor)、图标是本包资源(不是系统蓝色感叹号) |
| 本地通知 · 定时 | `dumpsys alarm` 里是 `type=RTC window=+11s` —— **非精确闹钟,系统给了 11 秒浮动窗口**。这就是撤掉 `SCHEDULE_EXACT_ALARM` 之后「可能晚到」的具体来源。到点准时出现 |
| 本地通知 · 取消 | 排完立刻取消,18 秒后系统里没有那条 |
| 通知权限流程 | `pm clear` 后首次调用弹出系统权限框,点允许后正常发出 |
| 保存到相册 | 文件写入 + MediaStore 已登记(**但见下面「要知道的」第 2 条**) |
| 生物识别 | 一个指纹都没录的机器上,用锁屏密码**验证通过**(见下面「修掉的」) |
| 自动重连 · 页面干净 | 断网→恢复,页面自动刷新 |
| 自动重连 · 有未填内容 | 输入框里填了字,断网→恢复,**页面没刷新,输入框内容还在** |
| **离线冷启动(4.2 重点)** | **断网 + 杀掉 app + 重新打开**:正常显示缓存的页面,`AppShell` 可用,`swControlled: true`。这正是审核员会做的操作 |
| 离线时导航到已缓存页面 | 正常打开,bridge 照样注入(证实「SW 必须传原始 request」那条规则) |
| 下载 | 系统 `DownloadManager` 接手,发通知,文件大小正确 |
| 下载 · 没有 `download` 属性 | 照样下载,页面不跳走 |
| 外链分流 | `example.com` 开在 **Chrome Custom Tab**(`CustomTabActivity`)里,我们的 WebView 还停在原页,按返回回到 app |
| 原生 Tab 栏 | 用 `adb input tap` **真实触摸**点四格,每格都跳对、高亮对 |
| 返回键 · 子页 | 回到上一页 |
| 返回键 · 首页双击退出 | 第一下弹「再按一次退出」,2 秒内第二下**退回桌面**(包括从子页后退回来的首页,见下面「修掉的」) |
| 深度链接(intent 投递) | 向运行中的 app 发 VIEW intent,页面跳到目标 URL —— 也包括后退过之后 |
| 下拉刷新 | 顶部拉够:刷新;拉 150px 没到阈值:不刷;页面滚到中间再下拉:正常滚动,不刷 |
| 转屏 | 竖 360×766 → 横 766×336 → 竖,Tab 栏一直贴底且宽度跟着变;**页面不重新加载**(`configChanges` 生效);横屏时刘海那一侧原生留了黑边,内容没被挡 |

### 修掉的(只有真机能发现)

**`biometric.verify()` 从第 2 步起就没工作过。**插件原生侧只有
`checkBiometry` 和 `internalAuthenticate`;`authenticate()` 只存在于插件的 JS 包装层。
`AppShell.invoke()` 直接打原生 bridge、绕过包装层,于是调了一个不存在的方法 ——
而 Capacitor 遇到这种情况**既不 resolve 也不 reject,Promise 永远悬着**。
编译、`verify`、插件名检查全绿,真机表现只是「点了没反应」。
已改为 `internalAuthenticate`,并加了两条 `verify` 检查(读插件真实源码里的 `@PluginMethod`)。

**没录指纹但有锁屏密码时,验证被提前拒绝。**`checkBiometry` 返回
`isAvailable: false` 不等于「没法验证」—— `allowDeviceCredential` 开着且
`deviceIsSecure: true` 时,用锁屏密码照样能过。已修,并在上面那台机器上端到端验证通过。

**后退一次之后,所有原生事件监听都静默失效。**冷启动的首页按返回正常;
但**从子页后退回来的首页**按返回毫无反应 —— 没有提示条、也不退出。
排查:不是 bfcache(JS 堆是新的,脚本重跑了);现场注册一个新监听能收到,
app-shell 自己的收不到。logcat 时间线显示后退后 **76ms** 脚本就把
`backButton` / `networkStatusChange` / `appUrlOpen` 注册完了,
而 Capacitor 在 `onPageStarted` 里调 `bridge.reset()` 清空所有原生监听 ——
这个回调异步投递,**比注册晚到**,把刚注册的清掉了。
影响 7 个监听:返回键(双击退出、`appshell:back`)、网络状态、**深度链接**、4 个**推送**事件。
已修:`listen()` 登记所有监听,页面加载后补注册(先 remove 再 add,不会重复),
并公开成 `AppShell.listen()`(网站自己监听原生事件也该用它)。修完后同样的场景实测通过。

**测试页自己写错了一处。**下载页第 3 个链接原本是 `sample.pdf?type=pdf...`,
本意是测「没扩展名的路径」,但**路径**仍然以 `.pdf` 结尾。已换成真没扩展名的
`/export-noext`,并把说明改对:Android 看服务器响应(这个链接会下载),
扩展名规则只在 iOS 上用。

**启动页背景色从来没生效过。**`splashBackground` 只写进了 `colors.xml`,
启动主题没引用它 —— Android 12+ 的系统启动页按启动主题画,于是用的是系统默认色
(这台是米色 `#F9EFE7`),深色模式下长什么样全看系统。已接上
(`windowSplashScreenBackground`),并加了两条 `verify` 检查。复测见下面「启动页逐帧实测」。

**内容页的状态栏没用上 `themeColor` 和 `statusBarStyle`。**状态栏底色是 AppCompat
默认窗口色(浅色 `#FAFAFA`、深色 `#303030`),图标跟着系统深浅色走 —— 深色模式下
状态栏 `#303030` 和页面 `#191D24` 是两块颜色。原因:Capacitor 8 核心自带的 SystemBars
插件把系统栏设成透明、把 decorView 背景设成主题的 `windowBackground`,还按系统深浅色
设图标,StatusBar 插件的配置全被盖掉。已改成:主题的 `windowBackground` = `themeColor`,
`MainActivity` 在 SystemBars 之后补设图标;`statusBarStyle` 加了 `"auto"`。复测:

| 场景 | 状态栏底 | 图标 | 对比度 |
|---|---|---|---|
| 浅色 · 桌面点图标冷启动(内容出来之后) | `#1565C0` | 白 | 5.75 |
| 深色 · 桌面点图标冷启动 | `#1565C0` | 白 | 5.75 |
| **app 开着时切到深色**(配置变化,SystemBars 会再设一次) | `#1565C0` | 白 | 5.75 |
| app 开着时切回浅色 | `#1565C0` | 白 | 5.75 |
| 横屏 | 顶部 `#1565C0`;刘海那侧仍是系统画的黑边,没多出色带 | | |

启动页那两段不受影响(插件保持启动页时仍是白底深色图标 5.74,系统启动页那段见下面第 4 条)。
这台手机是手势导航,底部没有导航条那一条;有三键导航条的手机上,那一条也会是 `themeColor`
配同样的图标 —— **没在真机上看过**。

### 启动页逐帧实测

**方法**:设备端连拍 `screencap`,每帧前记 `/proc/uptime`,从「点图标」那一刻算时间;
每帧取启动页背景色,再在状态栏时钟那一块找出底色和离它最远的像素,按 WCAG 算对比度。
正文最低要求 4.5,1.0 就是完全看不见。帧间隔约 0.45 秒,第一帧是桌面(壁纸编码慢,约 1.5 秒)。

| 场景 | 阶段 | 背景 | 状态栏图标 | 对比度 |
|---|---|---|---|---|
| 修之前 · 从桌面启动 | 系统启动页 | `#F9EFE7` 系统默认米色 ✗ | 白 | 1.13 ✗ |
| | 插件保持的启动页 | `#F9EFE7` | 深 | 5.50 |
| **修之后 · 浅色 · 桌面点图标** | 系统启动页(到 ~2.1 秒) | **`#FFFFFF`** ✓ | 白 | **1.00 ✗** |
| | 插件保持的启动页(~2.6–3.8 秒) | `#FFFFFF` | 深 | 5.74 |
| | 内容(~4.5 秒起) | 状态栏 `#FAFAFA` | 深 | 5.67 |
| **修之后 · 深色 · 桌面点图标** | 系统启动页 | **`#FFFFFF`** ✓ 不再看系统 | 白 | 1.00 ✗ |
| | 插件保持的启动页 | `#FFFFFF` | 深 | 5.74 |
| | 内容(~2.9 秒起) | 页面 `#191D24`,状态栏 `#303030` | 白 | 13.20 |
| 修之后 · 浅色 · **从设置里拉起** | 系统启动页 | `#FFFFFF` | **深** | 5.74 |

结论:背景色和深色模式这两项修好了。系统启动页那段的状态栏图标**没修好、也修不了**:
从桌面打开是白的,从设置里拉起是深的 —— 跟着上一个界面走,不看我们的启动主题。
见下面「要知道的」第 4 条。

深色模式那一行还能看出一件事:没配 `splashBackgroundDark`,启动页是白的、页面是深色的,
冷启动会**先白一下**。测试站有深色样式,可以把 `splashBackgroundDark` 配成 `#191D24`。

### 要知道的(不是 bug,是平台行为)

1. **离线时 `location.reload()` 会显示原生兜底页**,而不是 SW 缓存。
   冷启动和导航都走 SW 没问题,只有「刷新当前页」这个动作会绕过去。
   兜底页自己会在网络恢复时跳回来(实测看到了),所以用户最终不受影响。
   **别把这个当成「离线缓存坏了」** —— 测离线要用冷启动,不要用刷新。

2. **「保存到相册」在 Android 上存进的是 app 自己的媒体目录**:
   `Android/media/<包名>/<相册名>/`。系统相册里看得到(MediaStore 已登记),
   但**卸载 app 时这个目录会被一起删掉**。这是插件写死的
   (`MediaPlugin.java:237` 用 `getExternalMediaDirs()[0]`),没有选项能改。
   好处是不需要任何存储权限。对「存优惠券」够用;要是用户会指望这些图永久保留
   (比如发票、凭证),得换方案或者在界面上提示一句。

3. **Android 上 `<a download="文件名">` 里的文件名不生效。**
   原生的 `onDownloadStart` 拿不到这个属性,只拿得到 URL 和服务器的
   `Content-Disposition`。实测链接写的是 `download="testing-sample.pdf"`,
   存下来叫 `sample-1.pdf`(重名时系统自动加 `-1`)。
   **要控制文件名,让服务器发 `Content-Disposition: attachment; filename="..."`。**

4. **启动页头 ~2 秒的状态栏图标,在这台机器上沿用上一个界面的。**
   从桌面点图标:白图标,配白色启动页完全看不见(对比度 1.00);从设置里拉起:
   深色图标(5.74)。启动主题里的 `windowLightStatusBar` 在这段不起作用 —— 这段是系统画的,
   app 进程还没起来。之后插件保持启动页的那 ~1.5 秒,浅色、深色模式都是深色图标,正常。
   想让这 2 秒也看得清,只能换一个白图标也看得清的启动页底色(比如主题色 `#1565C0`,
   对比度 5.74);代价是桌面如果用深色图标(浅色壁纸),就反过来看不清。
   **这条只在 TECNO HiOS 上验证过**,别的厂商可能不同。

### 没测的

- iPhone(要 Sideloadly 重签,见第 2 节)
- 推送(要 Firebase 凭据和服务器)
- **App Links 域名验证**(intent 投递已经测过;但「在别的 app 里点网址自动跳进来」
  要 `.well-known` 在域名根目录,测试站在子路径下做不到)
- 触觉反馈的**手感**和七档区别 —— 只有人能判断,在「能力」页自己点那七个按钮
- iOS 上「路径没扩展名」的下载边界(那一项只在 iOS 上有意义)
- Android 12 以下的启动页(手上只有 Android 13)
- 别的厂商的启动页状态栏(只测了 TECNO HiOS)
- 三键导航的手机上底部那一条的样子(这台是手势导航)
- iOS 的状态栏(`statusBarStyle: "auto"` 在 iOS 上是跟系统走;底色仍是页面背景,没接 `themeColor`)

## 7. 测完之后

测试站只是脚手架。真正上架前这些还得换掉:

- 真域名和 `appId`(**`appId` 上架后改不了**)
- `app-tabbar.js` 的 `ITEMS` 换成你真站上的页面,并去掉 `/webview-app/` 前缀
- `app-shell.js` 的 `serviceWorkerUrl` 改回 `/sw.js`
- `app-capabilities.js` 的 `CONFIG.notifyChannel` 换成你的业务分类
- 占位图标
- `.well-known` 两个文件里的签名指纹和 Team ID,传到**域名根目录**
