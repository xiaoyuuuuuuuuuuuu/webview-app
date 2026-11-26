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
| 启动页、状态栏颜色、app 名和图标 | ✅ | 图标还是占位图 |
| 原生底部 Tab 栏、页面间跳转 | ✅ | |
| safe area(刘海/手势条) | ✅ | `native` 模式下四个值应该全是 0 |
| **生物识别** | ✅ | 两端 |
| **保存到相册** | ✅ | 两端 |
| **本地通知**(含定时) | ✅ | 两端 |
| **剪贴板(只写)** | ✅ | 两端 |
| **设备 ID** | ✅ | 两端 |
| **评分弹窗** | ✅ | 弹不出来是正常的 |
| 离线阅读(Service Worker) | ✅ | 作用域只限 `/webview-app/` |
| 下载 | ✅ | iOS 走应用内浏览器 |
| 外链分流 | ✅ | |
| Android 返回键 / 双击退出 | ✅ | |
| 下拉刷新 | ✅ | |
| **扫码** | ❌ | 本项目有意关掉了。点那个按钮应该回 `unsupported` |
| **深度链接 / Universal Links** | ❌ | 两个原因叠在一起:`.well-known` 必须在**域名根目录**,而测试站在 `/webview-app/` 子路径下;而且免费签名的包没有 `associated-domains`。要等你的真域名 |
| **推送通知** | ❌ | 要 Firebase 凭据 + 你自己的服务器 |
| **强制更新** | ❌ | `updateCheckUrl` 是空的(默认关闭) |

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
`[app-shell] Service Worker 注册失败` 那条警告。但**现在连不上**:

`capacitor.config.ts` 第 36 行是

```
webContentsDebuggingEnabled: false,  // 生产关闭远程调试
```

要连 `chrome://inspect` 调试,把它改成 `true`,然后重新构建:

```powershell
npm run sync
```

改完推上去跑一次 Android 构建,装新包,电脑 Chrome 打开 `chrome://inspect`
就能看到 WebView。**测完记得改回 `false`** —— 这个开着上架等于把调试口留给所有人。

iOS 那边是 Mac 上的 Safari → 开发 → 你的 iPhone,同样需要可调试的构建。

---

## 5. 验收清单

抄一份勾着走。**一条都没跑过的时候,别说"应该没问题"。**

```
壳
[ ] 装得上、打得开,不白屏
[ ] 启动页正常收起
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

## 6. 测完之后

测试站只是脚手架。真正上架前这些还得换掉:

- 真域名和 `appId`(**`appId` 上架后改不了**)
- `app-tabbar.js` 的 `ITEMS` 换成你真站上的页面,并去掉 `/webview-app/` 前缀
- `app-shell.js` 的 `serviceWorkerUrl` 改回 `/sw.js`
- `app-capabilities.js` 的 `CONFIG.notifyChannel` 换成你的业务分类
- 占位图标
- `.well-known` 两个文件里的签名指纹和 Team ID,传到**域名根目录**
