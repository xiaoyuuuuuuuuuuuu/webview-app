#!/usr/bin/env node
/**
 * 把 app.config.json 里的设置套用到项目各处。
 * 改完 app.config.json 后跑: npm run configure
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, enabledCapabilities, validateCapabilities } from './capabilities.mjs';
import { HEX_COLOR, prefersDarkIcons, statusBarWantsDarkIcons } from './colors.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));

// ---------- 校验 ----------
const errors = [];
let siteUrl;
try {
  siteUrl = new URL(cfg.siteUrl);
  if (siteUrl.protocol !== 'https:') {
    errors.push(`siteUrl 必须是 https:// 开头 (现在是 ${siteUrl.protocol}//)`);
  }
  // User-Agent 头只允许 ASCII 可见字符。写了中文或换行,轻则被服务器丢掉,
// 重则让整个请求头坏掉 —— 而且这种错只在真机上才看得出来,所以在这里挡住。
if (cfg.appendUserAgent) {
  const ua = String(cfg.appendUserAgent);
  if (!/^[\x20-\x7E]+$/.test(ua)) {
    errors.push('appendUserAgent 只能用 ASCII 可见字符(不能有中文、换行、制表符),现在是: ' + JSON.stringify(ua));
  }
  if (ua.length > 64) {
    errors.push(`appendUserAgent 太长了(${ua.length} 字符),控制在 64 以内`);
  }
}
if (/CHANGE-ME/i.test(cfg.siteUrl)) {
    errors.push('siteUrl 还没改 —— 把 app.config.json 里的 siteUrl 换成你的网址');
  }
} catch {
  errors.push(`siteUrl 不是合法网址: ${cfg.siteUrl}`);
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(cfg.appId)) {
  errors.push(`appId 格式不对: ${cfg.appId} (要像 com.yourcompany.app,只能小写字母数字和点)`);
}
if (/changeme/i.test(cfg.appId)) {
  errors.push('appId 还没改 —— 上架后就不能再改了,现在定好');
}
if (!HEX_COLOR.test(cfg.themeColor)) {
  errors.push(`themeColor 要是 #RRGGBB 格式: ${cfg.themeColor}`);
}
// 以前只校验 themeColor。splashBackground 写成 white 或 #fff 会生成不合法的
// Android 颜色资源,要到 CI 编译时才报错 —— 在这里就挡住。
if (!HEX_COLOR.test(cfg.splashBackground || '')) {
  errors.push(`splashBackground 要是 #RRGGBB 格式: ${cfg.splashBackground}`);
}
if (cfg.splashBackgroundDark && !HEX_COLOR.test(cfg.splashBackgroundDark)) {
  errors.push(`splashBackgroundDark 要是 #RRGGBB 格式,或者留空: ${cfg.splashBackgroundDark}`);
}
if (!['auto', 'light', 'dark'].includes(cfg.statusBarStyle)) {
  errors.push(`statusBarStyle 只能是 "auto"、"light" 或 "dark": ${cfg.statusBarStyle}`);
}
if (cfg.safeArea !== undefined && cfg.safeArea !== 'native' && cfg.safeArea !== 'cover') {
  errors.push(`safeArea 只能是 "native" 或 "cover": ${cfg.safeArea}`);
}
if (cfg.updateCheckUrl) {
  try {
    if (new URL(cfg.updateCheckUrl).protocol !== 'https:') {
      errors.push(`updateCheckUrl 必须是 https:// 开头: ${cfg.updateCheckUrl}`);
    }
  } catch {
    errors.push(`updateCheckUrl 不是合法网址: ${cfg.updateCheckUrl}`);
  }
}
errors.push(...validateCapabilities(cfg));
if (errors.length) {
  console.error('\n✗ app.config.json 有问题:\n');
  errors.forEach((e) => console.error('  • ' + e));
  console.error('');
  process.exit(1);
}

// ---------- 生成 www/ ----------
const subst = (s) =>
  s
    .replaceAll('{{SITE_URL}}', cfg.siteUrl)
    .replaceAll('{{APP_NAME}}', cfg.appName)
    .replaceAll('{{THEME_COLOR}}', cfg.themeColor);

mkdirSync(join(root, 'www'), { recursive: true });
for (const f of ['index.html', 'offline.html']) {
  const out = subst(readFileSync(join(root, 'scripts/templates', f), 'utf8'));
  writeFileSync(join(root, 'www', f), out);
  console.log(`✓ www/${f}`);
}

// ---------- 小工具 ----------
function patch(path, label, fn) {
  const abs = join(root, path);
  if (!existsSync(abs)) return false;
  const before = readFileSync(abs, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(abs, after);
    console.log(`✓ ${label}`);
  }
  return true;
}

/**
 * 受管区块:两个标记之间的内容整段由脚本重写。
 *
 * 关键性质是【关回去没有净改动】—— body 为空时整块(连标记一起)删掉,文件回到
 * 一个字都不差的原样。标记以换行开头、closeTag 也带换行,所以插入和删除严格互逆。
 * 这和 enablePushNotifications 关掉时要把 pbxproj 引用清干净是同一个要求:
 * Info.plist 里留一条没用的用途字符串,Apple 审核就会问这个权限干什么用。
 */
function managedBlock(source, beginMark, endMark, body, closeTag) {
  // 先统一成 LF 再找标记。标记是以 \n 开头的,而 Windows 上 git 可能按
  // core.autocrlf=true 把文件签出成 CRLF —— 那样 indexOf 找不到现有区块,
  // 就会走下面的"追加"分支,每跑一次 npm run sync 多注入一份。
  // Info.plist 里重复的键比 AndroidManifest 里重复的权限危险得多。
  // (.gitattributes 里也加了 eol=lf,这里是双保险:换到别人机器上也不复现)
  const src = source.replace(/\r\n/g, '\n');
  const b = src.indexOf(beginMark);
  const e = src.indexOf(endMark);
  if (b !== -1 && e !== -1 && e > b) {
    const head = src.slice(0, b);
    const tail = src.slice(e + endMark.length);
    return body ? head + beginMark + body + endMark + tail : head + tail;
  }
  if (!body) return src;
  const at = src.lastIndexOf(closeTag);
  if (at === -1) return src;
  return src.slice(0, at) + beginMark + body + endMark + src.slice(at);
}

const CAP_BEGIN_ANDROID =
  '\n\n    <!-- CAPABILITIES:BEGIN 由 scripts/configure.mjs 按 app.config.json 的 capabilities 生成,别手改 -->';
const CAP_END_ANDROID = '\n    <!-- CAPABILITIES:END -->';
// meta-data 必须落在 <application> 里面,所以和权限是两个不同的注入点。
const CAP_BEGIN_ANDROID_META =
  '\n\n        <!-- CAPABILITIES-META:BEGIN 由 scripts/configure.mjs 按 app.config.json 的 capabilities 生成,别手改 -->';
const CAP_END_ANDROID_META = '\n        <!-- CAPABILITIES-META:END -->';
const CAP_BEGIN_IOS =
  '\n\t<!-- CAPABILITIES:BEGIN 由 scripts/configure.mjs 按 app.config.json 的 capabilities 生成,别手改 -->';
const CAP_END_IOS = '\n\t<!-- CAPABILITIES:END -->';

const activeCapabilities = enabledCapabilities(cfg);
if (activeCapabilities.length) {
  console.log('  已开启的原生能力: ' + activeCapabilities.join(', '));
}

// ---------- Android ----------
if (existsSync(join(root, 'android'))) {
  patch('android/app/src/main/res/values/strings.xml', 'Android app 名称', (s) =>
    s
      .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${cfg.appName}$2`)
      .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${cfg.appName}$2`)
      .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${cfg.appId}$2`)
      .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${cfg.appId}$2`),
  );

  patch('android/app/build.gradle', 'Android applicationId', (s) =>
    s
      .replace(/applicationId\s*=?\s*"[^"]*"/, (m) =>
        m.includes('=') ? `applicationId = "${cfg.appId}"` : `applicationId "${cfg.appId}"`,
      )
      .replace(/namespace\s*=?\s*"[^"]*"/, (m) =>
        m.includes('=') ? `namespace = "${cfg.appId}"` : `namespace "${cfg.appId}"`,
      ),
  );

  // Java 源码的 package 必须跟 appId 一致,否则 AndroidManifest 里的 ".MainActivity"
  // 找不到类,编译直接失败。cap add 之后改 appId 就会踩这个坑,所以这里自动搬。
  const javaRoot = join(root, 'android/app/src/main/java');
  if (existsSync(javaRoot)) {
    const targetDir = join(javaRoot, ...cfg.appId.split('.'));
    const sources = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name.endsWith('.java') || entry.name.endsWith('.kt')) sources.push(abs);
      }
    })(javaRoot);

    const stale = sources.filter((f) => dirname(f) !== targetDir);
    if (stale.length) {
      mkdirSync(targetDir, { recursive: true });
      for (const src of stale) {
        // basename 而不是 split('/') —— Windows 上 join 产生的是反斜杠,
        // 按 '/' 切会原样返回整个绝对路径,拼出来的目标路径是坏的。
        const name = basename(src);
        const body = readFileSync(src, 'utf8').replace(
          /^package\s+[A-Za-z0-9_.]+\s*;?/m,
          src.endsWith('.kt') ? `package ${cfg.appId}` : `package ${cfg.appId};`,
        );
        writeFileSync(join(targetDir, name), body);
        rmSync(src);
        console.log(`\u2713 Android ${name} \u2192 package ${cfg.appId}`);
      }
      // 清掉搬空的旧目录
      (function prune(dir) {
        if (dir === javaRoot) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) prune(join(dir, entry.name));
        }
        if (readdirSync(dir).length === 0 && dir !== targetDir) {
          rmSync(dir, { recursive: true });
          prune(dirname(dir));
        }
      })(javaRoot);
      for (const entry of readdirSync(javaRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const abs = join(javaRoot, entry.name);
          const empty = (d) => {
            const items = readdirSync(d, { withFileTypes: true });
            return items.length === 0 || items.every((i) => i.isDirectory() && empty(join(d, i.name)));
          };
          if (!targetDir.startsWith(abs) && empty(abs)) rmSync(abs, { recursive: true });
        }
      }
    }
  }

  // 强制更新的版本接口地址。留空就是关闭,原生侧第一行就 return
  patch(
    `android/app/src/main/java/${cfg.appId.split('.').join('/')}/MainActivity.java`,
    'Android 版本接口地址',
    (s) => s.replace(/(UPDATE_CHECK_URL = ")[^"]*(")/, `$1${cfg.updateCheckUrl || ''}$2`),
  );

  // 深度链接(App Links)的 host
  patch('android/app/src/main/AndroidManifest.xml', 'Android 深度链接 host', (s) =>
    s.replace(/(<data android:scheme="https" android:host=")[^"]*(")/, `$1${siteUrl.host}$2`),
  );

  // 能力开关要的权限。多一个权限 = Google Play 的 Data safety 要多填一条,
  // 所以关掉的能力必须把权限也撤掉。
  patch('android/app/src/main/AndroidManifest.xml', 'Android 能力权限', (s) => {
    const perms = activeCapabilities.flatMap((name) => [
      // 要加的
      ...CAPABILITIES[name].android.map(
        (perm) =>
          '\n    <!-- capabilities.' + name + ' -->\n    <uses-permission android:name="' + perm + '" />',
      ),
      // 要撤的:插件自己的库 manifest 声明、Gradle 无条件合并进来的权限。
      // tools:node="remove" 是唯一的撤法 —— 我们的开关管不到别人的 manifest。
      ...(CAPABILITIES[name].androidRemove || []).map(
        (perm) =>
          '\n    <!-- capabilities.' + name + ' 撤掉插件库 manifest 合并进来的这一条,原因见 scripts/capabilities.mjs -->' +
          '\n    <uses-permission android:name="' + perm + '" tools:node="remove" />',
      ),
    ]);
    return managedBlock(s, CAP_BEGIN_ANDROID, CAP_END_ANDROID, perms.join(''), '\n</manifest>');
  });

  // tools: 这个命名空间只有 tools:node="remove" 才用得上,所以跟着开关加/撤 ——
  // 这样把所有能力关回去之后,Manifest 仍然字节级回到原样。
  patch('android/app/src/main/AndroidManifest.xml', 'Android tools 命名空间', (s) => {
    const needed = activeCapabilities.some((name) => (CAPABILITIES[name].androidRemove || []).length);
    const attr = ' xmlns:tools="http://schemas.android.com/tools"';
    const anchor = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"';
    const present = s.includes(attr);
    if (needed && !present) return s.replace(anchor, anchor + attr);
    if (!needed && present) return s.replace(attr, '');
    return s;
  });

  // 能力要的 <meta-data>。和权限分开,因为它必须在 <application> 内部。
  patch('android/app/src/main/AndroidManifest.xml', 'Android 能力 meta-data', (s) => {
    const metas = activeCapabilities.flatMap((name) =>
      (CAPABILITIES[name].androidMeta || []).map(
        (m) =>
          '\n        <!-- capabilities.' + name + ' -->\n        <meta-data android:name="' +
          m.name + '" android:value="' + m.value + '" />',
      ),
    );
    return managedBlock(s, CAP_BEGIN_ANDROID_META, CAP_END_ANDROID_META, metas.join(''), '\n    </application>');
  });

  // 主题色
  const colorsPath = 'android/app/src/main/res/values/colors.xml';
  if (!existsSync(join(root, colorsPath))) {
    mkdirSync(dirname(join(root, colorsPath)), { recursive: true });
    writeFileSync(
      join(root, colorsPath),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`,
    );
  }
  patch(colorsPath, 'Android 主题色', (s) => {
    let out = s;
    const set = (name, value) => {
      const re = new RegExp(`(<color name="${name}">)[^<]*(</color>)`);
      if (re.test(out)) out = out.replace(re, `$1${value}$2`);
      else out = out.replace('</resources>', `    <color name="${name}">${value}</color>\n</resources>`);
    };
    set('colorPrimary', cfg.themeColor);
    set('colorPrimaryDark', cfg.themeColor);
    set('colorAccent', cfg.themeColor);
    set('splashBackground', cfg.splashBackground);
    return out;
  });

  // ---------- 启动页(Android 12+ 的系统启动页) ----------
  //
  // 【真机查出来的】启动主题 AppTheme.NoActionBarLaunch 的父主题是 Theme.SplashScreen,
  // Android 12+ 的系统启动页就按它画。以前它只设了 android:background,结果:
  //   - splashBackground 只写进了 colors.xml,【没有任何地方引用】,配了等于没配;
  //     背景是系统默认色(TECNO BG6 上是米色,换台手机就是别的颜色)
  //   - 深色模式下长什么样全看系统
  // 现在 styles.xml 引用 @color/splashBackground 和 @bool/splashLightStatusBar,
  // 这里按 app.config.json 写这两个值。图标深浅按 WCAG 对比度算(见 colors.mjs)。
  // 注意:启动页头 ~2 秒的状态栏图标在 TECNO 上沿用上一个界面,这个 bool 管不到,
  // 见 styles.xml 里的说明。
  const SPLASH_MARK = '由 scripts/configure.mjs 按 app.config.json 生成,别手改';
  const splashXml = (lightStatusBar, color) =>
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<!-- ${SPLASH_MARK} -->\n` +
    '<resources>\n' +
    (color ? `    <color name="splashBackground">${color}</color>\n` : '') +
    `    <bool name="splashLightStatusBar">${lightStatusBar}</bool>\n` +
    '</resources>\n';

  const writeIfChanged = (rel, content, label) => {
    const abs = join(root, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === content) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`✓ ${label}`);
  };

  // 浅色(默认):背景色已经在 colors.xml 里,这里只写图标深浅
  writeIfChanged(
    'android/app/src/main/res/values/splash.xml',
    splashXml(prefersDarkIcons(cfg.splashBackground)),
    'Android 启动页状态栏图标',
  );

  // 深色模式:配了 splashBackgroundDark 才写 values-night;没配就删掉,
  // 让深色模式也用上面那套 —— 总之【不再交给系统决定】。
  // 只删带生成标记的文件,手写的同名文件不碰。
  const nightRel = 'android/app/src/main/res/values-night/splash.xml';
  if (cfg.splashBackgroundDark) {
    writeIfChanged(
      nightRel,
      splashXml(prefersDarkIcons(cfg.splashBackgroundDark), cfg.splashBackgroundDark),
      'Android 启动页(深色模式)',
    );
  } else if (existsSync(join(root, nightRel)) && readFileSync(join(root, nightRel), 'utf8').includes(SPLASH_MARK)) {
    rmSync(join(root, nightRel));
    const dir = dirname(join(root, nightRel));
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
    console.log('✓ 去掉深色模式启动页(splashBackgroundDark 没配,深色模式用浅色那套)');
  }

  // ---------- 状态栏(app 运行时) ----------
  //
  // 【真机查出来的】以前 themeColor 和 statusBarStyle 在 Android 内容页上都没生效:
  // 状态栏是 AppCompat 默认窗口色 #FAFAFA(深色模式 #303030),图标跟着系统深浅色走。
  // Capacitor 8 核心的 SystemBars 插件把系统栏设成透明、把 decorView 背景设成主题的
  // windowBackground,还按系统深浅色设图标 —— StatusBar 插件的配置全被盖掉。
  // 现在主题的 windowBackground 和图标深浅引用这里写的两个值,MainActivity 在
  // SystemBars 之后补设图标。见 styles.xml 和 MainActivity.applySystemBarIcons。
  writeIfChanged(
    'android/app/src/main/res/values/statusbar.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      `<!-- ${SPLASH_MARK} -->\n` +
      '<resources>\n' +
      `    <color name="statusBarBackground">${cfg.themeColor}</color>\n` +
      `    <bool name="statusBarDarkIcons">${statusBarWantsDarkIcons(cfg.statusBarStyle, cfg.themeColor)}</bool>\n` +
      '</resources>\n',
    'Android 状态栏颜色和图标',
  );
}

// ---------- iOS ----------
if (existsSync(join(root, 'ios'))) {
  patch('ios/App/App/Info.plist', 'iOS 显示名称', (s) =>
    s.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${cfg.appName}$2`,
    ),
  );
  patch('ios/App/App.xcodeproj/project.pbxproj', 'iOS bundle id', (s) =>
    s.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${cfg.appId};`),
  );

  // 能力开关要的 iOS 用途字符串。声明了却没有对应功能,审核会问这个权限干什么用;
  // 反过来少了用途字符串,调用相机 / 面容 ID 是【直接崩】,不是返回错误。
  patch('ios/App/App/Info.plist', 'iOS 能力用途字符串', (s) => {
    // 同一个 key 可能被多个能力声明(scanner 和 cameraUpload 都要相机)。
    // plist 里重复的 key 是非法的,所以先到先得,只写一条。
    const seen = new Set();
    const lines = activeCapabilities.flatMap((name) =>
      Object.entries(CAPABILITIES[name].ios)
        .filter(([key]) => (seen.has(key) ? false : seen.add(key)))
        .map(
          ([key, text]) =>
            '\n\t<!-- capabilities.' + name + ' -->\n\t<key>' + key + '</key>\n\t<string>' + text + '</string>',
        ),
    );
    return managedBlock(s, CAP_BEGIN_IOS, CAP_END_IOS, lines.join(''), '\n</dict>');
  });

  // entitlements 从模板生成:host 跟着 siteUrl,推送那一项跟着 enablePushNotifications。
  // 多一项 entitlement 就多一条"App ID 要开对应能力"的前提,所以不用的不要留。
  {
    const pushBlock = cfg.enablePushNotifications
      ? '\n\t<!-- 推送。要求 App ID 开 Push Notifications。archive 发布时 Xcode 会把\n' +
        '\t     development 换成 production,所以这里写 development 是对的。 -->\n' +
        '\t<key>aps-environment</key>\n\t<string>development</string>\n'
      : '';
    const out = readFileSync(join(root, 'scripts/templates/App.entitlements'), 'utf8')
      .replaceAll('{{SITE_HOST}}', siteUrl.host)
      .replaceAll('{{PUSH_ENTITLEMENT}}', pushBlock);
    const abs = join(root, 'ios/App/App/App.entitlements');
    if (!existsSync(abs) || readFileSync(abs, 'utf8') !== out) {
      writeFileSync(abs, out);
      console.log('✓ iOS App.entitlements');
    }
  }

  // GoogleService-Info.plist 必须进 Xcode target,光把文件放对位置不够。
  // 没有 Mac 的人没法在 Xcode 里拖文件,所以这一步必须由脚本来做。
  // 反过来,推送没开的时候要把它从 target 里拿掉 —— Copy Resources 阶段
  // 引用一个不存在的文件会让构建直接失败。
  {
    const FILE_REF = '7F1A2B3C4D5E6F7081920004';
    const BUILD_REF = '7F1A2B3C4D5E6F7081920005';
    patch('ios/App/App.xcodeproj/project.pbxproj', 'iOS GoogleService-Info.plist 入 target', (s) => {
      const present = s.includes(FILE_REF);
      if (cfg.enablePushNotifications && !present) {
        return s
          .replace(
            '/* End PBXBuildFile section */',
            `\t\t${BUILD_REF} /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* GoogleService-Info.plist */; };\n/* End PBXBuildFile section */`,
          )
          .replace(
            '/* End PBXFileReference section */',
            `\t\t${FILE_REF} /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
          )
          .replace(
            '\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n',
            `\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n\t\t\t\t${FILE_REF} /* GoogleService-Info.plist */,\n`,
          )
          .replace(
            '\t\t\t\t2FAD9763203C412B000D30F8 /* config.xml in Resources */,\n',
            `\t\t\t\t2FAD9763203C412B000D30F8 /* config.xml in Resources */,\n\t\t\t\t${BUILD_REF} /* GoogleService-Info.plist in Resources */,\n`,
          );
      }
      if (!cfg.enablePushNotifications && present) {
        return s
          .split('\n')
          .filter((line) => !line.includes(FILE_REF) && !line.includes(BUILD_REF))
          .join('\n');
      }
      return s;
    });
  }

  // 强制更新的版本接口地址
  patch('ios/App/App/MainViewController.swift', 'iOS 版本接口地址', (s) =>
    s.replace(/(updateCheckUrl = ")[^"]*(")/, `$1${cfg.updateCheckUrl || ''}$2`),
  );

  // 主题色。iOS 这边没有 colors.xml 那种东西,所以注入到 MainViewController 的
  // themeColorHex 常量 —— 这样主题色仍然只在 app.config.json 配一次。
  patch('ios/App/App/MainViewController.swift', 'iOS 主题色', (s) =>
    s.replace(
      /(themeColorHex\s*=\s*")[^"]*(")/,
      `$1${cfg.themeColor}$2`,
    ),
  );

  // Xcode 的 scheme 默认只存在本机的 xcuserdata 里,不进 git。
  // 云端构建(GitHub Actions)没有它 xcodebuild 会直接失败,所以这里补一个 shared scheme。
  const schemeDir = join(root, 'ios/App/App.xcodeproj/xcshareddata/xcschemes');
  const schemePath = join(schemeDir, 'App.xcscheme');
  if (!existsSync(schemePath)) {
    const pbx = readFileSync(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const section = pbx.slice(
      pbx.indexOf('Begin PBXNativeTarget section'),
      pbx.indexOf('End PBXNativeTarget section'),
    );
    const uuid = section.match(/([0-9A-F]{24}) \/\* App \*\/ = \{/)?.[1];
    if (uuid) {
      mkdirSync(schemeDir, { recursive: true });
      const tpl = readFileSync(join(root, 'scripts/templates/App.xcscheme'), 'utf8');
      writeFileSync(schemePath, tpl.replaceAll('{{TARGET_UUID}}', uuid));
      console.log('\u2713 iOS shared scheme (云端构建需要)');
    } else {
      console.warn('⚠ 没找到 iOS target UUID,shared scheme 没生成');
    }
  }
}

// ---------- 深度链接要放到网站根目录的两个文件 ----------
// 只在文件不存在、或者里面还是占位符的时候写 —— 指纹和 Team ID 是手填的,
// 填完之后再跑 configure 不能把它们覆盖掉。
{
  const dir = join(root, 'website/.well-known');
  const PLACEHOLDER = 'REPLACE_WITH';
  const nl = '\n';

  const files = {
    'assetlinks.json':
      JSON.stringify(
        [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: cfg.appId,
              sha256_cert_fingerprints: ['REPLACE_WITH_SHA256_CERT_FINGERPRINT'],
            },
          },
        ],
        null,
        2,
      ) + nl,
    // 故意没有 .json 后缀 —— Apple 要求这个文件就叫这个名字,
    // 而且响应头必须是 Content-Type: application/json
    'apple-app-site-association':
      JSON.stringify(
        {
          applinks: {
            details: [{ appIDs: [`REPLACE_WITH_TEAM_ID.${cfg.appId}`], components: [{ '/': '*' }] }],
          },
        },
        null,
        2,
      ) + nl,
  };

  for (const [name, body] of Object.entries(files)) {
    const abs = join(dir, name);
    const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (existing !== null && !existing.includes(PLACEHOLDER)) continue; // 用户已经填过了,别覆盖
    if (existing === body) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, body);
    console.log(`✓ website/.well-known/${name}(占位符待填)`);
  }
}

console.log(`\n配置完成:
  网站    ${cfg.siteUrl}
  app 名  ${cfg.appName}
  appId   ${cfg.appId}
  主题色  ${cfg.themeColor}

下一步: npx cap sync\n`);
