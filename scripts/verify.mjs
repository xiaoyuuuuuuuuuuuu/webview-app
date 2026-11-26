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

soft('app-shell.js 已上传到网站', () => '脚本查不到这个 —— 自己确认 ' + cfg.siteUrl + '/app-shell.js 能打开');

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
