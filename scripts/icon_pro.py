#!/usr/bin/env python3
"""
Icônes JobConnect au style « médaille » (or + navy profond), même méthode que
le modèle de référence : fond radial, anneau doré biseauté, emblème, wordmark
métallique, reflet supérieur.

    python3 scripts/icon_pro.py "uploads/logo.png"
"""
import importlib.util
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
GOLD_LIGHT = (253, 230, 138)
GOLD = (245, 158, 11)
GOLD_DARK = (146, 64, 14)
NAVY = (8, 13, 30)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def gold_text(img: Image.Image, xy, text, fnt, spacing=0):
    """Écrit un texte avec dégradé or (haut clair, bas foncé)."""
    mask = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(mask)
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=255)
        x += d.textlength(ch, font=fnt) + spacing
    bbox = mask.getbbox()
    if not bbox:
        return
    grad = Image.new("RGB", img.size, GOLD)
    gd = ImageDraw.Draw(grad)
    top, bottom = bbox[1], bbox[3]
    for y2 in range(top, bottom + 1):
        t = (y2 - top) / max(1, bottom - top)
        if t < 0.45:
            c = tuple(int(GOLD_LIGHT[i] + (GOLD[i] - GOLD_LIGHT[i]) * (t / 0.45)) for i in range(3))
        else:
            c = tuple(int(GOLD[i] + (GOLD_DARK[i] - GOLD[i]) * ((t - 0.45) / 0.55)) for i in range(3))
        gd.line([(0, y2), (img.width, y2)], fill=c)
    img.paste(grad, (0, 0), mask)


def disc(size: int) -> Image.Image:
    """Masque circulaire (la médaille est ronde, comme le modèle)."""
    m = Image.new("L", (size * 4, size * 4), 0)
    r = int(size * 0.5 * 4)
    ImageDraw.Draw(m).ellipse(((size * 2 - r), (size * 2 - r), (size * 2 + r), (size * 2 + r)), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def medallion(mark: Image.Image, size: int, subtitle=None, wordmark="JOBCONNECT") -> Image.Image:
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    base = Image.new("RGB", (S, S), NAVY)
    halo = Image.new("L", (S, S), 0)
    ImageDraw.Draw(halo).ellipse((int(S * .18), int(S * .10), int(S * .82), int(S * .74)), fill=90)
    halo = halo.filter(ImageFilter.GaussianBlur(S * .05))
    base.paste(Image.new("RGB", (S, S), (40, 58, 120)), (0, 0), halo)
    img.paste(base, (0, 0), disc(S))

    rays = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays)
    for i in range(36):
        a = (i / 36) * math.tau
        rd.line(
            [(S / 2, S / 2), (S / 2 + math.cos(a) * S, S / 2 + math.sin(a) * S)],
            fill=(245, 158, 11, 16),
            width=max(1, S // 220),
        )
    img.alpha_composite(rays)

    ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(ring)
    pad = S * .022
    rdraw.ellipse((pad, pad, S - pad, S - pad), outline=GOLD_LIGHT, width=int(S * .028))
    rdraw.ellipse(
        (pad + S * .028, pad + S * .028, S - pad - S * .028, S - pad - S * .028),
        outline=GOLD,
        width=int(S * .016),
    )
    img.alpha_composite(ring)

    logo = mark.copy()
    logo.thumbnail((int(S * .62), int(S * .62)), Image.LANCZOS)
    img.alpha_composite(logo, (int((S - logo.width) / 2), int(S * .115 if wordmark or subtitle else S * .18)))

    draw = ImageDraw.Draw(img)
    y = int(S * .625)
    if wordmark:
        # le wordmark reste toujours à l'intérieur de l'anneau
        fsize = int(S * .080)
        while fsize > 8:
            f = font(fsize)
            w = sum(draw.textlength(c, font=f) for c in wordmark) + fsize * .05 * (len(wordmark) - 1)
            if w < S * .62:
                break
            fsize -= max(1, int(S * .004))
        gold_text(img, ((S - w) / 2, y + S * .018), wordmark, f, spacing=fsize * .05)
        y += int(S * .100)

    if subtitle:
        # sous-titre auto-ajusté : il ne sort jamais de l'anneau
        fsize2 = int(S * .058)
        maxw = S * .60
        while fsize2 > 6:
            f2 = font(fsize2)
            sp = f2.size * .16
            probe = sum(draw.textlength(c, font=f2) for c in subtitle) + sp * (len(subtitle) - 1)
            if probe <= maxw:
                break
            fsize2 -= max(1, int(S * .003))
        f2 = font(fsize2)
        sp = f2.size * .16
        w2 = sum(draw.textlength(c, font=f2) for c in subtitle) + sp * (len(subtitle) - 1)
        sy = y + S * .026
        gold_text(img, ((S - w2) / 2, sy), subtitle, f2, spacing=sp)
        # filets dorés de part et d'autre du sous-titre
        ly = sy + int(f2.size * .62)
        gap = S * .035
        left_end = (S - w2) / 2 - gap
        right_start = (S + w2) / 2 + gap
        if left_end - S * .20 > S * .03:
            draw.line([(int(S * .20), ly), (int(left_end), ly)], fill=GOLD, width=int(S * .008))
        if S * .80 - right_start > S * .03:
            draw.line([(int(right_start), ly), (int(S * .80), ly)], fill=GOLD, width=int(S * .008))

    gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse(
        (int(S * .06), int(-S * .30), int(S * .94), int(S * .46)), fill=(255, 255, 255, 26)
    )
    gloss = gloss.filter(ImageFilter.GaussianBlur(S * .02))
    gloss.putalpha(Image.composite(gloss.getchannel("A"), Image.new("L", (S, S), 0), disc(S)))
    img.alpha_composite(gloss)

    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).ellipse((1, 1, S - 2, S - 2), outline=(255, 236, 179, 190), width=max(1, S // 320))
    img.alpha_composite(edge)

    img.putalpha(disc(S))
    return img.resize((size, size), Image.LANCZOS)


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        ROOT / "uploads" / "Logo corporate JobConnect _ opportunités globales.png"
    )
    if not src.exists():
        sys.exit(f"logo source introuvable : {src}")

    spec = importlib.util.spec_from_file_location("brand", ROOT / "scripts" / "brand.py")
    brand = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(brand)
    mark = brand.white_to_alpha(brand.isolate_mark(Image.open(src).convert("RGBA")))

    web = ROOT / "public" / "brand"
    res = ROOT / "android" / "app" / "src" / "main" / "res"

    for size in (192, 512):
        medallion(mark, size, subtitle="WORK WITHOUT BORDERS").save(web / f"icon-{size}.png", optimize=True)
    for size in (16, 32, 48, 180):
        medallion(mark, size, wordmark=None).save(web / f"icon-{size}.png", optimize=True)
    medallion(mark, 256, wordmark=None).save(web / "logo-mark.png", optimize=True)
    medallion(mark, 256, wordmark=None).save(
        web / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )

    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dpi, px in densities.items():
        folder = res / f"mipmap-{dpi}"
        folder.mkdir(parents=True, exist_ok=True)
        medallion(mark, px, wordmark=None).save(folder / "ic_launcher.png", optimize=True)
        medallion(mark, px, wordmark=None).save(folder / "ic_launcher_round.png", optimize=True)
        medallion(mark, px, subtitle="ADMIN", wordmark=None).save(folder / "ic_admin.png", optimize=True)

    drawable = res / "drawable"
    for name, sub in (("ic_launcher_foreground.png", None), ("ic_admin_foreground.png", "ADMIN")):
        tile = medallion(mark, 432, subtitle=sub, wordmark=None).convert("RGBA")
        small = tile.resize((int(432 * .74), int(432 * .74)), Image.LANCZOS)
        fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
        fg.paste(small, ((432 - small.width) // 2, (432 - small.height) // 2), small)
        fg.save(drawable / name, optimize=True)

    print("icônes médaille générées")


if __name__ == "__main__":
    main()
