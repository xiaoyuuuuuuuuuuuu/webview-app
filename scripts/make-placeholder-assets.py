#!/usr/bin/env python3
"""
生成占位用的 app 图标和启动页(assets/)。

换成你自己的图之后就不用再跑这个了 —— 直接把 assets/icon.png 换掉,
然后跑: npx capacitor-assets generate

用法: python3 scripts/make-placeholder-assets.py
"""
import json, pathlib, unicodedata
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "app.config.json").read_text())

theme = cfg["themeColor"]
splash_bg = cfg.get("splashBackground", "#ffffff")
name = (cfg.get("appName") or "A").strip()
letter = name[0].upper()

CJK_FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
LATIN_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def is_cjk(ch: str) -> bool:
    try:
        return "CJK" in unicodedata.name(ch)
    except ValueError:
        return False


def load_font(size: int):
    path = CJK_FONT if is_cjk(letter) else LATIN_FONT
    if not pathlib.Path(path).exists():
        path = LATIN_FONT
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def rounded(size: int, radius_ratio: float, fill: str) -> Image.Image:
    """画一个抗锯齿的圆角方块。"""
    scale = 4
    big = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, size * scale - 1, size * scale - 1],
        radius=int(size * scale * radius_ratio),
        fill=fill,
    )
    return big.resize((size, size), Image.LANCZOS)


def draw_centered_letter(img: Image.Image, box: int, color="#ffffff"):
    d = ImageDraw.Draw(img)
    font = load_font(int(box * 0.52))
    l, t, r, b = d.textbbox((0, 0), letter, font=font)
    d.text(
        ((img.width - (r - l)) / 2 - l, (img.height - (b - t)) / 2 - t),
        letter, font=font, fill=color,
    )


assets = ROOT / "assets"
assets.mkdir(exist_ok=True)

# --- 图标: 满幅主题色(系统会自己裁圆角/圆形) ---
icon = Image.new("RGBA", (1024, 1024), theme)
draw_centered_letter(icon, 1024)
icon.convert("RGB").save(assets / "icon.png")

# --- 启动页: 浅色 ---
for fname, bg in [("splash.png", splash_bg), ("splash-dark.png", "#0c0c0e")]:
    sp = Image.new("RGBA", (2732, 2732), bg)
    mark = rounded(480, 0.22, theme)
    draw_centered_letter(mark, 480)
    sp.alpha_composite(mark, ((2732 - 480) // 2, (2732 - 480) // 2))
    sp.convert("RGB").save(assets / fname)

# 记下占位图的哈希,verify 靠它判断你换没换图标
import hashlib
digest = hashlib.sha256((assets / "icon.png").read_bytes()).hexdigest()
(assets / ".placeholder-marker").write_text(digest + "\n")

print(f"""占位素材已生成 (字母 "{letter}", 主题色 {theme}):
  assets/icon.png          1024x1024
  assets/splash.png        2732x2732
  assets/splash-dark.png   2732x2732

换成真图标: 把 assets/icon.png 替换掉(1024x1024,别留透明边),然后
  npx capacitor-assets generate""")
