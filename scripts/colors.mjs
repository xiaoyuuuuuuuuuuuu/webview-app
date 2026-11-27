/**
 * 颜色工具 —— configure.mjs 和 verify.mjs 共用,免得两边各算一套、算得不一样。
 */

/** app.config.json 里所有颜色都要求这个格式(Android 颜色资源和 iOS 常量都直接用它) */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** WCAG 2.x 相对亮度,0(黑)~ 1(白) */
export function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 这个背景上该用【深色】状态栏图标吗?
 *
 * 不拍脑袋定一个 0.5 的阈值,而是直接比 WCAG 对比度:黑字在这个背景上的对比度
 * 和白字的对比度,哪个高用哪个。两者相等的点在亮度 ≈ 0.179,所以像 #1565C0 这种
 * 看着"不算太暗"的品牌蓝(亮度 ≈ 0.13)会选白字 —— 这和肉眼判断一致。
 */
export function prefersDarkIcons(hex) {
  const L = relativeLuminance(hex);
  const contrastWithBlack = (L + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (L + 0.05);
  return contrastWithBlack > contrastWithWhite;
}
