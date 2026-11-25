#!/usr/bin/env node
/**
 * 把 app.config.json 里的设置套用到项目各处。
 * 改完 app.config.json 后跑: npm run configure
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (!/^#[0-9a-f]{6}$/i.test(cfg.themeColor)) {
  errors.push(`themeColor 要是 #RRGGBB 格式: ${cfg.themeColor}`);
}
if (cfg.safeArea !== undefined && cfg.safeArea !== 'native' && cfg.safeArea !== 'cover') {
  errors.push(`safeArea 只能是 "native" 或 "cover": ${cfg.safeArea}`);
}
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

console.log(`\n配置完成:
  网站    ${cfg.siteUrl}
  app 名  ${cfg.appName}
  appId   ${cfg.appId}
  主题色  ${cfg.themeColor}

下一步: npx cap sync\n`);
