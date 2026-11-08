#!/usr/bin/env python3
"""
Génère tous les visuels de marque JobConnect à partir du logo source.

    python3 scripts/brand.py "uploads/Logo corporate JobConnect _ opportunités globales.png"

Produit :
  public/brand/logo-mark.png    logo rogné sur pastille claire (en-tête / pied de page)
  public/brand/logo-full.png    logo complet sur fond transparent (OG / partages)
  public/brand/icon-*.png       icônes du site (favicon, PWA, apple-touch)
  public/brand/favicon.ico
  android/.../mipmap-*/         icônes de l'application publique
  android/.../drawable/ic_launcher_foreground.png
  brand/admin-icon-*.png        icône de la console ADMIN (pastille « ADMIN »)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
NAVY_TOP = (13, 30, 61)
NAVY_BOTTOM = (21, 60, 140)
ACCENT = (37, 99, 235)


def trim_logo(src: Image.Image) -> Image.Image:
    """Rogne le logo sur son contenu réel (ignore le fond blanc)."""
    rgb = Image.new("RGB", src.size, (255, 255, 255))
    rgb.paste(src.convert("RGBA"), mask=src.convert("RGBA").split()[3])
    gray = rgb.convert("L")
    mask = gray.point(lambda v: 255 if v < 240 else 0)
    bbox = mask.getbbox()
    return src.crop(bbox) if bbox else src


def isolate_mark(src: Image.Image) -> Image.Image:
    """Ne garde que le symbole (globe + flèche), sans le mot « JobConnect »."""
    import numpy as np

    trimmed = trim_logo(src)
    gray = np.array(trimmed.convert("L"))
    ink = gray < 240
    profile = ink.mean(axis=1)
    # bandes blanches franches (séparation symbole / texte)
    blank = profile < 0.02
    bands, start = [], None
    for i, is_blank in enumerate(blank):
        if is_blank and start is None:
            start = i
        elif not is_blank and start is not None:
            if i - start > 4:
                bands.append((start, i))
            start = None
    if start is not None and len(blank) - start > 4:
        bands.append((start, len(blank)))
    # on coupe à la première bande franche située dans la moitié basse :
    # c'est la séparation entre le symbole et le mot « JobConnect »
    cut = None
    for b0, b1 in bands:
        if b0 > trimmed.height * 0.45:
            cut = b0
            break
    if cut:
        trimmed = trimmed.crop((0, 0, trimmed.width, cut))
    return trimmed


def white_to_alpha(img: Image.Image, cutoff: int = 250) -> Image.Image:
    """Rend transparent le fond blanc d'un visuel (utile sur fond marine)."""
    import numpy as np

    rgba = img.convert("RGBA")
    arr = np.asarray(rgba).astype(np.float32)
    rgb, a0 = arr[..., :3], arr[..., 3] / 255.0
    whiteness = rgb.min(axis=2)                      # 255 sur le blanc pur
    alpha = np.clip((cutoff - whiteness) / cutoff, 0.0, 1.0) * a0
    safe = np.maximum(alpha, 1e-3)[..., None]
    unmult = np.clip((rgb - (1.0 - alpha[..., None]) * 255.0) / safe, 0, 255)
    out = np.concatenate([unmult, (alpha * 255)[..., None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def squircle(size: int, radius_ratio: float = 0.22) -> Image.Image:
    """Masque en carré arrondi (style icône mobile)."""
    s = size * 4
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, s - 1, s - 1), radius=int(s * radius_ratio), fill=255
    )
    return mask.resize((size, size), Image.LANCZOS)


def gradient(size: int) -> Image.Image:
    """Dégradé bleu nuit diagonal."""
    small = Image.new("RGB", (2, 2))
    small.putpixel((0, 0), NAVY_TOP)
    small.putpixel((1, 0), (17, 42, 88))
    small.putpixel((0, 1), (16, 46, 100))
    small.putpixel((1, 1), NAVY_BOTTOM)
    return small.resize((size, size), Image.BICUBIC)


def fit(img: Image.Image, box: int) -> Image.Image:
    out = img.copy()
    out.thumbnail((box, box), Image.LANCZOS)
    return out


def on_tile(mark: Image.Image, size: int, pad: float = 0.16, dark=True) -> Image.Image:
    """Place le logo centré sur une tuile (dégradé marine ou blanc)."""
    canvas = gradient(size) if dark else Image.new("RGB", (size, size), (255, 255, 255))
    inner = int(size * (1 - 2 * pad))
    logo = fit(mark, inner)
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo if logo.mode == "RGBA" else None)
    out = canvas.convert("RGBA")
    out.putalpha(squircle(size))
    return out


def pick_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def admin_icon(mark: Image.Image, size: int, transparent_mark: bool = True) -> Image.Image:
    """Icône admin : tuile marine, symbole sur pastille claire, badge « ADMIN »."""
    if transparent_mark:
        mark = white_to_alpha(mark)

    canvas = gradient(size).convert("RGBA")

    # halo bleu discret pour la profondeur
    halo = Image.new("L", (size, size), 0)
    ImageDraw.Draw(halo).ellipse(
        (int(size * .16), int(size * .08), int(size * .84), int(size * .62)), fill=70
    )
    halo = halo.filter(ImageFilter.GaussianBlur(size * .08))
    canvas.paste(Image.new("RGB", (size, size), (70, 140, 255)), (0, 0), halo)

    # pastille claire portant le symbole
    cx, cy, r = size * 0.5, size * 0.36, size * 0.315
    plate = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(plate).ellipse(
        (
            (cx - r) * 4,
            (cy - r) * 4,
            (cx + r) * 4,
            (cy + r) * 4,
        ),
        fill=255,
    )
    plate = plate.resize((size, size), Image.LANCZOS)
    shadow = plate.filter(ImageFilter.GaussianBlur(size * .035))
    canvas.paste(Image.new("RGB", (size, size), (3, 10, 26)), (0, int(size * .012)), shadow.point(lambda v: int(v * .55)))
    canvas.paste(Image.new("RGB", (size, size), (255, 255, 255)), (0, 0), plate)

    logo = fit(mark, int(r * 1.55))
    canvas.paste(logo, (int(cx - logo.width / 2), int(cy - logo.height / 2)), logo)

    # badge ADMIN
    text = "A D M I N"
    font_size = max(9, int(size * 0.085))
    font = pick_font(font_size)
    bbox = font.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = int(font_size * 0.8), int(font_size * 0.6)
    pill_w, pill_h = tw + pad_x * 2, th + pad_y * 2
    pill_x = (size - pill_w) // 2
    pill_y = int(size * 0.735)
    pill = Image.new("L", (pill_w * 4, pill_h * 4), 0)
    ImageDraw.Draw(pill).rounded_rectangle(
        (0, 0, pill_w * 4 - 1, pill_h * 4 - 1), radius=pill_h * 2, fill=255
    )
    pill = pill.resize((pill_w, pill_h), Image.LANCZOS)
    canvas.paste(Image.new("RGB", (pill_w, pill_h), (255, 255, 255)), (pill_x, pill_y), pill)
    ImageDraw.Draw(canvas).text(
        (pill_x - bbox[0] + pad_x, pill_y - bbox[1] + pad_y),
        text,
        font=font,
        fill=(13, 30, 61),
    )

    out = canvas.copy()
    out.putalpha(squircle(size))
    return out


def main() -> None:
    src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        ROOT / "uploads" / "Logo corporate JobConnect _ opportunités globales.png"
    )
    if not src_path.exists():
        sys.exit(f"logo source introuvable : {src_path}")

    src = Image.open(src_path).convert("RGBA")
    mark = isolate_mark(src)

    web = ROOT / "public" / "brand"
    web.mkdir(parents=True, exist_ok=True)
    admin_dir = ROOT / "brand"
    admin_dir.mkdir(parents=True, exist_ok=True)

    # --- logo complet transparent (OG, partages) -------------------------
    full = white_to_alpha(mark)
    full.thumbnail((640, 640), Image.LANCZOS)
    full.save(web / "logo-full.png", optimize=True)

    # --- pastille logo pour l'en-tête -----------------------------------
    on_tile(mark, 256, pad=0.10, dark=False).save(web / "logo-mark.png", optimize=True)

    # --- icônes du site --------------------------------------------------
    for size in (16, 32, 48, 180, 192, 512):
        on_tile(mark, size, pad=0.16 if size < 48 else 0.14, dark=False).save(
            web / f"icon-{size}.png", optimize=True
        )
    base = on_tile(mark, 256, pad=0.14, dark=False).convert("RGBA")
    base.save(
        web / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # --- Android : application publique ---------------------------------
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dpi, px in densities.items():
        folder = res / f"mipmap-{dpi}"
        folder.mkdir(parents=True, exist_ok=True)
        tile = on_tile(mark, px, pad=0.17, dark=False)
        tile.save(folder / "ic_launcher.png", optimize=True)
        round_tile = on_tile(mark, px, pad=0.22, dark=False)
        round_tile.putalpha(_circle_mask(px))
        round_tile.save(folder / "ic_launcher_round.png", optimize=True)
        admin_icon(mark, px).save(folder / "ic_admin.png", optimize=True)

    drawable = res / "drawable"
    drawable.mkdir(parents=True, exist_ok=True)
    # avant-plan adaptatif : 108dp, le logo doit tenir dans les 66dp centraux
    fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    logo = fit(mark, int(432 * 0.52))
    fg.paste(logo, ((432 - logo.width) // 2, (432 - logo.height) // 2), logo)
    fg.save(drawable / "ic_launcher_foreground.png", optimize=True)

    admin_fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    a = admin_icon(mark, 432).crop((0, 0, 432, 432))
    # la pastille ADMIN est déjà dans l'image : on la centre dans la zone sûre
    a_small = a.resize((int(432 * 0.78), int(432 * 0.78)), Image.LANCZOS)
    admin_fg.paste(a_small, ((432 - a_small.width) // 2, (432 - a_small.height) // 2), a_small)
    admin_fg.save(drawable / "ic_admin_foreground.png", optimize=True)

    # --- icône admin haute résolution (communication / Play Store) ------
    for size in (48, 72, 96, 144, 192, 512, 1024):
        admin_icon(mark, size).save(admin_dir / f"admin-icon-{size}.png", optimize=True)

    print("visuels générés :", web, "|", admin_dir, "|", res)


def _circle_mask(px: int) -> Image.Image:
    m = Image.new("L", (px * 4, px * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
    return m.resize((px, px), Image.LANCZOS)


if __name__ == "__main__":
    main()
