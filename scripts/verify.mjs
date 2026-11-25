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

  check('用 SPM 而不是 CocoaPods', () =>
    has('ios/App/CapApp-SPM/Package.swift') || '没找到 Package.swift');
}

// ---------------- 网站侧 ----------------
console.log('\n网站侧');
check('app-shell.js 存在', () => has('website/app-shell.js') || '文件丢了');
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
