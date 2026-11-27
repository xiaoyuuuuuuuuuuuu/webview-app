#!/usr/bin/env node
/**
 * 自检:确认 app.config.json 的设置真的落到了 Android / iOS 项目的每个角落。
 * 跑: npm run verify   (建议每次 npm run sync 之后跑一下)
 *
 * 这个脚本不编译,只检查配置一致性 —— 大部分「能装但白屏」「编译失败」
 * 的问题都是这里面某一项不一致导致的。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, enabledCapabilities, validateCapabilities } from './capabilities.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (p) => existsSync(join(root, p));

let pass = 0;
const fails = [];
const warns = [];

function check(label, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log(`  ✓ ${label}`); }
    else { fails.push(`${label} — ${r}`); console.log(`  ✗ ${label}  (${r})`); }
  } catch (e) {
    fails.push(`${label} — ${e.message}`);
    console.log(`  ✗ ${label}  (${e.message})`);
  }
}
function soft(label, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log(`  ✓ ${label}`); }
    else { warns.push(`${label} — ${r}`); console.log(`  ! ${label}  (${r})`); }
  } catch (e) {
    warns.push(`${label} — ${e.message}`);
    console.log(`  ! ${label}  (${e.message})`);
  }
}

const host = new URL(cfg.siteUrl).host;

console.log('\napp.config.json');
check('siteUrl 是 https', () => cfg.siteUrl.startsWith('https://') || '必须是 https');
check('siteUrl 已填写', () => !/CHANGE-ME/i.test(cfg.siteUrl) || '还是占位符');
check('appId 已填写', () => !/changeme/i.test(cfg.appId) || '还是占位符');
check('capabilities 开关合法', () => {
  const errs = validateCapabilities(cfg);
  return errs.length === 0 || errs.join(';');
});

// ---------------- Android ----------------
if (has('android')) {
  console.log('\nAndroid');

  check('applicationId == appId', () => {
    const g = read('android/app/build.gradle');
    const m = g.match(/applicationId\s*=?\s*"([^"]+)"/);
    return m?.[1] === cfg.appId || `build.gradle 里是 ${m?.[1]}`;
  });

  check('namespace == appId', () => {
    const m = read('android/app/build.gradle').match(/namespace\s*=?\s*"([^"]+)"/);
    return m?.[1] === cfg.appId || `build.gradle 里是 ${m?.[1]}`;
  });

  check('MainActivity 在 appId 对应的目录里', () => {
    const want = join('android/app/src/main/java', ...cfg.appId.split('.'), 'MainActivity.java');
    return has(want) || `找不到 ${want}(AndroidManifest 的 .MainActivity 会解析失败 → 编译或启动崩溃)`;
  });

  check('MainActivity 的 package 声明正确', () => {
    const p = join('android/app/src/main/java', ...cfg.appId.split('.'), 'MainActivity.java');
    if (!has(p)) return '文件不存在';
    const m = read(p).match(/package\s+([A-Za-z0-9_.]+)\s*;/);
    return m?.[1] === cfg.appId || `声明的是 ${m?.[1]}`;
  });

  check('没有残留的旧包目录', () => {
    const javaRoot = join(root, 'android/app/src/main/java');
    const found = [];
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.java') || e.name.endsWith('.kt')) found.push(join(d, e.name));
      }
    })(javaRoot);
    const wantDir = join(javaRoot, ...cfg.appId.split('.'));
    const stray = found.filter((f) => dirname(f) !== wantDir);
    return stray.length === 0 || `还有 ${stray.length} 个源文件在旧目录(会撞类名)`;
  });

  check('app 名称已同步', () => {
    const m = read('android/app/src/main/res/values/strings.xml')
      .match(/<string name="app_name">([^<]*)<\/string>/);
    return m?.[1] === cfg.appName || `strings.xml 里是 ${m?.[1]}`;
  });

  check('同步过的 config 指向你的网站', () => {
    const p = 'android/app/src/main/assets/capacitor.config.json';
    if (!has(p)) return '没找到(先跑 npm run sync)';
    const c = JSON.parse(read(p));
    if (c.server?.url !== cfg.siteUrl) return `config 里是 ${c.server?.url}(先跑 npm run sync)`;
    if (c.appId !== cfg.appId) return `config 里 appId 是 ${c.appId}`;
    return true;
  });

  check('离线页已打包进 app', () => {
    const p = 'android/app/src/main/assets/public/offline.html';
    if (!has(p)) return '没找到(先跑 npm run sync)';
    return read(p).includes(cfg.siteUrl) || '离线页里的网址还是旧的';
  });

  check('errorPath 配好了(断网时才会显示离线页)', () => {
    const c = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
    return c.server?.errorPath === 'offline.html' || `现在是 ${c.server?.errorPath}`;
  });

  // 这一项错了只在真机上看得出来(服务器收到的 UA 不对),所以机器来对
  check('appendUserAgent 已同步', () => {
    const c = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
    const want = cfg.appendUserAgent || '';
    if (!want) {
      return c.appendUserAgent === undefined
        || `app.config.json 没设 appendUserAgent,但同步出来的 config 里还有 ${JSON.stringify(c.appendUserAgent)}`;
    }
    return c.appendUserAgent === want
      || `config 里是 ${JSON.stringify(c.appendUserAgent)},app.config.json 里是 ${JSON.stringify(want)}(先跑 npm run sync)`;
  });

  check('allowNavigation 包含你的域名', () => {
    const c = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
    const list = c.server?.allowNavigation || [];
    return list.some((h) => h === host || host.endsWith(h.replace(/^\*\./, '.')))
      || `列表里没有 ${host}:${JSON.stringify(list)}`;
  });

  check('能力权限与开关一致', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const active = enabledCapabilities(cfg);
    const wanted = new Set(active.flatMap((n) => CAPABILITIES[n].android));
    const bad = [];
    for (const perm of wanted) {
      if (!manifest.includes(`android:name="${perm}"`)) bad.push(`少了 ${perm}(先跑 npm run configure)`);
    }
    // 关掉的能力不能留着权限 —— 多一个权限 Play 的 Data safety 就要多填一条
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      if (active.includes(name)) continue;
      for (const perm of def.android) {
        if (manifest.includes(`<!-- capabilities.${name} -->`)) bad.push(`${name} 关着但 Manifest 里还有它的区块`);
      }
    }
    return bad.length === 0 || bad.join(';');
  });

  // 插件自己的库 manifest 声明的权限,Gradle 会无条件合并进 app —— 我们的开关管不到,
  // 只能用 tools:node="remove" 撤。漏了这一步最严重的后果不是运行时出错,而是
  // 带着 SCHEDULE_EXACT_ALARM 根本【没法在 Google Play 发版】(除非符合精确定时政策)。
  check('该撤的权限都撤了', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const active = enabledCapabilities(cfg);
    const bad = [];
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      const on = active.includes(name);
      for (const perm of def.androidRemove || []) {
        const line = `<uses-permission android:name="${perm}" tools:node="remove" />`;
        const present = manifest.includes(line);
        if (on && !present) bad.push(`${name} 开着但没撤 ${perm}(先跑 npm run configure)`);
        if (!on && present) bad.push(`${name} 关着但还留着撤 ${perm} 的那一行`);
      }
    }
    return bad.length === 0 || bad.join(';');
  });

  // tools:node="remove" 没有这个命名空间就是编译错误,不是静默失效
  check('tools 命名空间跟着开关走', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const active = enabledCapabilities(cfg);
    const needed = active.some((n) => (CAPABILITIES[n].androidRemove || []).length);
    const present = manifest.includes('xmlns:tools="http://schemas.android.com/tools"');
    if (needed && !present) return '要用 tools:node="remove" 但 <manifest> 上没有 xmlns:tools → Gradle 会报编译错误';
    if (!needed && present) return '没有任何能力需要撤权限,但 xmlns:tools 还留着(关掉应该清干净)';
    return true;
  });

  // 通知小图标必须是白色剪影;不配的话插件兜底用系统那个蓝色感叹号
  soft('本地通知有自己的小图标', () => {
    if (!enabledCapabilities(cfg).includes('localNotifications')) return true;
    if (!has('android/app/src/main/res/drawable/ic_stat_notify.xml')) {
      return 'drawable/ic_stat_notify.xml 不在 → 插件会兜底用 android.R.drawable.ic_dialog_info(系统蓝色感叹号)';
    }
    return read('capacitor.config.ts').includes("smallIcon: 'ic_stat_notify'")
      || 'capacitor.config.ts 的 LocalNotifications.smallIcon 没指向 ic_stat_notify';
  });

  check('targetSdk >= 36 (Google Play 要求)', () => {
    const m = read('android/variables.gradle').match(/targetSdkVersion\s*=\s*(\d+)/);
    return Number(m?.[1]) >= 36 || `现在是 ${m?.[1]}`;
  });

  soft('图标已换掉占位图', () => {
    if (!has('assets/.placeholder-marker')) return true;
    if (!has('assets/icon.png')) return 'assets/icon.png 不见了';
    const want = read('assets/.placeholder-marker').trim();
    const got = createHash('sha256').update(readFileSync(join(root, 'assets/icon.png'))).digest('hex');
    return got !== want || '还在用占位图标 \u2014 上架前一定要换(不换容易被 Apple 按 4.3 Spam 拒)';
  });
}

// ---------------- iOS ----------------
if (has('ios')) {
  console.log('\niOS');

  check('bundle id 全部 == appId', () => {
    const ids = [...read('ios/App/App.xcodeproj/project.pbxproj')
      .matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1].trim());
    const bad = ids.filter((i) => i !== cfg.appId);
    return bad.length === 0 || `有 ${bad.length} 处不一致: ${[...new Set(bad)].join(', ')}`;
  });

  check('显示名称已同步', () => {
    const m = read('ios/App/App/Info.plist')
      .match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/);
    return m?.[1] === cfg.appName || `Info.plist 里是 ${m?.[1]}`;
  });

  check('有 shared scheme (云端构建必需)', () => {
    const p = 'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme';
    if (!has(p)) return '没有 App.xcscheme → GitHub Actions 上 xcodebuild 会直接失败';
    const want = read('ios/App/App.xcodeproj/project.pbxproj')
      .slice(0, 100000)
      .match(/([0-9A-F]{24}) \/\* App \*\/ = \{\s*isa = PBXNativeTarget/)?.[1];
    const got = read(p).match(/BlueprintIdentifier="([^"]+)"/)?.[1];
    if (!want) return 'pbxproj 里没找到 target';
    return want === got || `scheme 指向的 target 不对(${got} vs ${want})`;
  });

  check('同步过的 config 指向你的网站', () => {
    const p = 'ios/App/App/capacitor.config.json';
    if (!has(p)) return '没找到(先跑 npm run sync)';
    const c = JSON.parse(read(p));
    return c.server?.url === cfg.siteUrl || `config 里是 ${c.server?.url}(先跑 npm run sync)`;
  });

  check('离线页已打包进 app', () =>
    has('ios/App/App/public/offline.html') || '没找到(先跑 npm run sync)');

  check('能力用途字符串与开关一致', () => {
    const plist = read('ios/App/App/Info.plist');
    const active = enabledCapabilities(cfg);
    const bad = [];
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      const on = active.includes(name);
      for (const key of Object.keys(def.ios)) {
        const present = plist.includes(`<key>${key}</key>`);
        // 开了却没有 → iOS 上调用会直接崩;关了却留着 → 审核会问这个权限干什么用
        if (on && !present) bad.push(`${name} 开着但 Info.plist 少 ${key}(先跑 npm run configure)`);
        if (!on && present) bad.push(`${name} 关着但 Info.plist 还留着 ${key}`);
      }
    }
    return bad.length === 0 || bad.join(';');
  });

  check('用 SPM 而不是 CocoaPods', () =>
    has('ios/App/CapApp-SPM/Package.swift') || '没找到 Package.swift');
}

// ---------------- 网站侧 ----------------
console.log('\n网站侧');
check('app-shell.js 存在', () => has('website/app-shell.js') || '文件丢了');
// 这一条原来只能靠人记住:safeArea 一个在原生侧、一个在 app-shell.js 的 CONFIG 里,
// 脚本读不到前者。现在机器来对,不一致会导致刘海屏上内容被挡或者多一条白边。
check('app-shell.js 的 safeArea 和 app.config.json 一致', () => {
  const m = read('website/app-shell.js').match(/safeArea:\s*'([^']+)'/);
  const want = cfg.safeArea || 'native';
  if (!m) return "app-shell.js 里找不到 CONFIG.safeArea";
  return m[1] === want || `app-shell.js 里是 '${m[1]}',app.config.json 里是 '${want}'`;
});

check('app-shell.js 暴露了 AppShell 契约', () => {
  const js = read('website/app-shell.js');
  const missing = ['version:', 'invoke:', 'has:', 'capabilities:'].filter((k) => !js.includes(k));
  return missing.length === 0 || `导出里少了 ${missing.join(' ')}`;
});

// 插件名写错的后果是 has() 永远返回 false,而且不报错 —— 所以让机器对一遍
check('能力的插件名两边一致', () => {
  const js = read('website/app-shell.js');
  const bad = [];
  for (const [name, def] of Object.entries(CAPABILITIES)) {
    // 用 indexOf 找 `name: 'Plugin'`,不写正则 —— 这一行写错的后果是 has() 永远
    // 返回 false 而且不报错,所以这个检查本身也要尽量简单到不会出错。
    const marker = name + ": '";
    const at = js.indexOf(marker);
    if (at === -1) {
      bad.push(`app-shell.js 的 CAPABILITY_PLUGIN 里没有 ${name}`);
      continue;
    }
    const rest = js.slice(at + marker.length);
    const got = rest.slice(0, rest.indexOf("'"));
    if (got !== def.plugin) {
      bad.push(`${name}: app-shell.js 写 ${got},capabilities.mjs 写 ${def.plugin}`);
    }
  }
  return bad.length === 0 || bad.join(';');
});

// 插件装上之后,注册名就能跟【真插件】对 —— 这比只比对我们自己那两个文件强得多:
// 两边一致地写错,上面那个检查是发现不了的。biometric 就踩过这个:包名是
// capacitor-biometric-auth,但注册名实际是 BiometricAuthNative。
check('能力的插件名和真插件一致', () => {
  const bad = [];
  let checked = 0;
  for (const [name, def] of Object.entries(CAPABILITIES)) {
    const entry = `node_modules/${def.npm}/dist/esm/index.js`;
    if (!has(entry)) continue;
    checked++;
    const src = read(entry);
    const marker = "registerPlugin('";
    const at = src.indexOf(marker);
    if (at === -1) {
      bad.push(`${name}: 读不出 ${def.npm} 的注册名`);
      continue;
    }
    const rest = src.slice(at + marker.length);
    const real = rest.slice(0, rest.indexOf("'"));
    if (real !== def.plugin) {
      bad.push(`${name}: 真插件是 ${real},capabilities.mjs 写的是 ${def.plugin}`);
    }
  }
  if (checked === 0) return true;   // 一个插件都没装,没什么可对的
  return bad.length === 0 || bad.join(';');
});

// 这一条是真机测出来的那个 bug 的系统性修复。
//
// AppShell.invoke() 直接打原生 bridge,【绕过插件的 JS 包装层】。所以只能调
// 原生侧真实存在的 @PluginMethod。包装层里有的名字,原生侧不一定有同名的 ——
// biometric 就是:JS 层叫 authenticate(),原生层其实叫 internalAuthenticate。
//
// 调错名字的后果不是报错,是【静默挂死】:Capacitor 找不到方法,既不 resolve
// 也不 reject,Promise 永远悬着。编译、插件名检查、权限检查全都发现不了,
// 真机上的表现只是"点了没反应"。所以必须让机器来对。
check('调的原生方法都真实存在', () => {
  const bad = [];
  let checked = 0;

  for (const [name, def] of Object.entries(CAPABILITIES)) {
    const methods = def.nativeMethods || [];
    if (!methods.length) continue;
    const base = join(root, 'node_modules', def.npm, 'android');
    if (!existsSync(base)) continue;   // 插件没装,跳过

    // 把插件 Android 源码里所有 @PluginMethod 的方法名收起来(Java 和 Kotlin 都认)
    const declared = new Set();
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(java|kt)$/.test(e.name)) {
          const src = readFileSync(full, 'utf8');
          // @PluginMethod 之后的第一个方法名
          const re = /@PluginMethod[\s\S]{0,200}?(?:public|private|protected|internal)?\s*(?:void|fun)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
          let m;
          while ((m = re.exec(src)) !== null) declared.add(m[1]);
        }
      }
    };
    try { walk(base); } catch (e) { continue; }
    if (declared.size === 0) continue;   // 读不出来就别误报

    checked++;
    for (const method of methods) {
      if (!declared.has(method)) {
        bad.push(`${name}: ${def.plugin}.${method} 在原生侧不存在(实际有: ${[...declared].sort().join(', ')})`);
      }
    }
  }

  if (checked === 0) return true;
  return bad.length === 0 || bad.join(';');
});

// 另一个方向:app-capabilities.js 里实际 invoke 的每一对(插件, 方法)
// 都必须登记在 nativeMethods 里 —— 否则加了新调用却没人对它做上面那个检查。
check('invoke 调的方法都登记过', () => {
  if (!has('website/app-capabilities.js')) return true;
  const js = read('website/app-capabilities.js');
  const active = enabledCapabilities(cfg);
  // 只看 invoke('Plugin', 'method' 这种字面量写法
  const re = /invoke\(\s*'([A-Za-z]+)'\s*,\s*'([A-Za-z]+)'/g;
  const byPlugin = {};
  for (const [name, def] of Object.entries(CAPABILITIES)) {
    byPlugin[def.plugin] = { name, methods: def.nativeMethods || [] };
  }
  const bad = [];
  let m;
  while ((m = re.exec(js)) !== null) {
    const [, plugin, method] = m;
    const entry = byPlugin[plugin];
    if (!entry) { bad.push(`调了 ${plugin}.${method},但登记表里没有这个插件`); continue; }
    if (!active.includes(entry.name)) continue;   // 能力关着,先不管
    if (!entry.methods.includes(method)) {
      bad.push(`调了 ${plugin}.${method},但 ${entry.name} 的 nativeMethods 里没登记它`);
    }
  }
  return bad.length === 0 || [...new Set(bad)].join(';');
});

// 反方向:插件装了但开关没开。这个状态是危险的 —— Capacitor 会把所有已安装的
// 插件都编进 app(XSS 影响面已经扩大了),但开关没开就没声明权限和 iOS 用途字符串,
// 结果 has() 返回 true、调用却必然失败,而且 iOS 上缺用途字符串是直接崩。
check('装了插件的能力开关都开着', () => {
  const active = enabledCapabilities(cfg);
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  const bad = Object.entries(CAPABILITIES)
    .filter(([name, def]) => deps[def.npm] && !active.includes(name))
    .map(([name, def]) => `${name}(装了 ${def.npm} 但开关是 false)`);
  return bad.length === 0 ||
    '插件已经编进 app 但权限没声明,调用必然失败: ' + bad.join('; ');
});

// iOS 用的是 SPM(见 BUILD_SPEC 坑 3:云端构建不装 CocoaPods)。没有 Package.swift 的
// 插件进不了 SPM 构建 —— Android 有、iOS 没有,这种平台不对称很隐蔽,所以明确报出来。
// 后果不是崩,而是 has() 在 iOS 上返回 false、能力静默缺失。对 Apple 4.2 来说
// 一个只在 Android 上存在的能力贡献是零。
soft('开启的能力在 iOS 上也可用', () => {
  const active = enabledCapabilities(cfg);
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  const androidOnly = active.filter(
    (n) => deps[CAPABILITIES[n].npm] && !has(`node_modules/${CAPABILITIES[n].npm}/Package.swift`),
  );
  return androidOnly.length === 0 ||
    `这些能力只在 Android 上有(插件没有 Package.swift,SPM 构建不包含): ${androidOnly.join('、')}` +
    ' —— 网站侧必须用 AppShell.has() 判断后降级,而且它们对 Apple 4.2 不算数';
});

check('开了能力就要有 app-capabilities.js', () => {
  const active = enabledCapabilities(cfg);
  if (!active.length) return true;
  return (
    has('website/app-capabilities.js') ||
    `开了 ${active.join(' / ')} 但 website/app-capabilities.js 不在 —— 网站侧没有接口可调`
  );
});

// 这一条补的是扫码那次暴露的漏洞:开关、权限、插件全对,网站侧却没有能调的东西,
// 而且所有其他检查都是绿的。现在登记表的 shellApi 字段说了该有什么,机器来对。
check('开了的能力在网站侧都有接口', () => {
  const active = enabledCapabilities(cfg);
  if (!active.length) return true;
  if (!has('website/app-capabilities.js')) return 'app-capabilities.js 不在';
  const js = read('website/app-capabilities.js');
  const bad = [];
  for (const name of active) {
    const api = CAPABILITIES[name].shellApi || [];
    if (!api.length) {
      bad.push(`${name}: 登记表里没写 shellApi,无法检查`);
      continue;
    }
    const absent = api.filter((member) => !js.includes(`AppShell.${member} =`));
    if (absent.length) {
      bad.push(`${name}: app-capabilities.js 没有导出 ${absent.map((m) => 'AppShell.' + m).join(' / ')}`);
    }
  }
  return bad.length === 0 || bad.join(';');
});

// 开关开了但插件没装:configure 不会替你装,所以这里提醒一下
soft('开启的能力都装了插件', () => {
  const active = enabledCapabilities(cfg);
  if (!active.length) return true;
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  const missing = active.filter((n) => !deps[CAPABILITIES[n].npm]);
  return missing.length === 0 ||
    '这些开关开着但插件没装: ' + missing.map((n) => `${n} → npm i ${CAPABILITIES[n].npm}`).join('; ');
});

// 取 siteUrl 所在的【目录】，不是把 siteUrl 直接拼上文件名（siteUrl 可以带路径，
// 拼出来会是个不存在的地址），也不是 origin（站点在子路径时 origin 指不到文件）。
//   https://shop.example.com                  -> https://shop.example.com/app-shell.js
//   https://u.github.io/repo/index.html       -> https://u.github.io/repo/app-shell.js
soft('app-shell.js 已上传到网站', () => {
  const u = new URL(cfg.siteUrl);
  const dir = u.origin + u.pathname.replace(/[^/]*$/, '');
  return '脚本查不到这个 —— 自己确认 ' + dir + 'app-shell.js 能打开';
});

// ---------------- 结果 ----------------
console.log(`\n${'─'.repeat(52)}`);
if (fails.length === 0) {
  console.log(`✓ ${pass} 项检查全部通过`);
  if (warns.length) console.log(`! ${warns.length} 项需要你自己确认(见上面的 !)`);
  console.log('');
} else {
  console.log(`✗ ${fails.length} 项有问题:\n`);
  fails.forEach((f) => console.log('  • ' + f));
  console.log('\n大多数情况下跑一次 `npm run sync` 就能修好。\n');
  process.exit(1);
}
