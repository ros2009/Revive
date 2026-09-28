#!/usr/bin/env python3
"""
sprite_aligner.py - Alinea automaticamente imagenes 2D de un personaje.

Pensado para imagenes generadas con IA, donde el personaje sale cada vez en
una posicion, tamano y fondo distinto. El script:

  1. Quita el fondo (si la imagen no tiene transparencia) detectando el color
     de las esquinas.
  2. Recorta al contenido real del personaje (bounding box).
  3. Opcionalmente escala todos los personajes a la misma altura.
  4. Coloca cada personaje en un lienzo del mismo tamano, con el mismo punto
     de anclaje (por defecto: los pies centrados abajo).
  5. Guarda PNGs con transparencia listos para Unreal (Paper2D) y, si se
     pide, una hoja de sprites (spritesheet) con su JSON.

Uso basico:
    python sprite_aligner.py entrada/ salida/

Ver todas las opciones:
    python sprite_aligner.py --help
"""

import argparse
import json
import math
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("Faltan dependencias. Instala con:  pip install pillow numpy")

EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".tif", ".tiff"}


# ---------------------------------------------------------------------------
# Fondo y recorte
# ---------------------------------------------------------------------------

def has_real_alpha(img):
    """True si la imagen ya tiene pixeles transparentes."""
    if img.mode != "RGBA":
        return False
    return img.getchannel("A").getextrema()[0] < 250


def remove_background(img, tolerance, softness):
    """
    Quita un fondo de color (casi) uniforme. El color se estima con la mediana
    de los bordes de la imagen, y solo se borra la zona de fondo conectada a
    los bordes, asi no se hacen agujeros en el personaje si tiene ese color.
    """
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb = rgba[..., :3]
    h, w = rgb.shape[:2]

    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)

    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    candidate = dist <= tolerance

    # Flood fill desde los bordes (solo fondo conectado).
    background = _flood_from_border(candidate)

    alpha = rgba[..., 3].copy()
    alpha[background] = 0

    # Borde suave: pixeles cercanos al color de fondo junto al fondo borrado.
    if softness > 0:
        edge = _dilate(background, 1) & ~background
        ramp = np.clip((dist - tolerance) / softness, 0.0, 1.0)
        alpha[edge] = np.minimum(alpha[edge], ramp[edge] * 255.0)

    rgba[..., 3] = alpha
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def _flood_from_border(mask):
    """Devuelve los pixeles de `mask` conectados con el borde de la imagen."""
    filled = np.zeros_like(mask)
    filled[0, :] = mask[0, :]
    filled[-1, :] = mask[-1, :]
    filled[:, 0] = mask[:, 0]
    filled[:, -1] = mask[:, -1]
    while True:
        grown = _dilate(filled, 1) & mask
        if np.array_equal(grown, filled):
            return filled
        # Crecer varios pasos de golpe acelera mucho el bucle.
        for _ in range(15):
            grown = _dilate(grown, 1) & mask
        filled = grown


def _dilate(mask, r):
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:, :] |= out[:-1, :]
        m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        out = m
    return out


def content_bbox(img, alpha_threshold):
    """Bounding box (x0, y0, x1, y1) de los pixeles visibles."""
    a = np.asarray(img.getchannel("A"))
    mask = a > alpha_threshold
    if not mask.any():
        return None
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def remove_small_islands(img, alpha_threshold, min_fraction):
    """Borra manchas sueltas (restos del fondo, firmas, ruido de la IA)."""
    if min_fraction <= 0:
        return img
    rgba = np.asarray(img).copy()
    mask = rgba[..., 3] > alpha_threshold
    labels, sizes = _label(mask)
    if not sizes:
        return img
    biggest = max(sizes.values())
    for lbl, size in sizes.items():
        if size < biggest * min_fraction:
            rgba[labels == lbl, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def _label(mask):
    """Etiquetado de componentes conexas (4-vecinos) sin scipy."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes = {}
    current = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        current += 1
        stack = [(y0, x0)]
        labels[y0, x0] = current
        count = 0
        while stack:
            y, x = stack.pop()
            count += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    stack.append((ny, nx))
        sizes[current] = count
    return labels, sizes


# ---------------------------------------------------------------------------
# Punto de anclaje
# ---------------------------------------------------------------------------

def anchor_point(img, mode, alpha_threshold, feet_band):
    """
    Devuelve (x, y) del punto de anclaje dentro de la imagen recortada.

    feet    -> centro horizontal de los pies (franja inferior), y = abajo
    bottom  -> centro del bounding box, y = abajo
    mass    -> centro de masa horizontal de todo el personaje, y = abajo
    center  -> centro del bounding box
    """
    a = np.asarray(img.getchannel("A")).astype(np.float32)
    a[a <= alpha_threshold] = 0
    h, w = a.shape

    if mode == "center":
        return w / 2.0, h / 2.0
    if mode == "bottom":
        return w / 2.0, float(h)

    if mode == "feet":
        band = max(1, int(round(h * feet_band)))
        region = a[h - band:, :]
    else:  # mass
        region = a

    cols = region.sum(axis=0)
    total = cols.sum()
    if total <= 0:
        return w / 2.0, float(h)
    cx = float((cols * (np.arange(w) + 0.5)).sum() / total)
    return cx, float(h)


# ---------------------------------------------------------------------------
# Proceso principal
# ---------------------------------------------------------------------------

def load_and_clean(path, args):
    img = Image.open(path)
    img.load()
    img = img.convert("RGBA")

    if args.remove_bg == "always" or (args.remove_bg == "auto" and not has_real_alpha(img)):
        img = remove_background(img, args.bg_tolerance, args.bg_softness)

    img = remove_small_islands(img, args.alpha_threshold, args.min_island)

    bbox = content_bbox(img, args.alpha_threshold)
    if bbox is None:
        return None
    return img.crop(bbox)


def next_pow2(n):
    return 1 << max(0, math.ceil(math.log2(max(1, n))))


def process(args):
    in_dir = Path(args.input)
    out_dir = Path(args.output)

    if in_dir.is_file():
        files = [in_dir]
    else:
        files = sorted(p for p in in_dir.iterdir() if p.suffix.lower() in EXTENSIONS)
    if not files:
        sys.exit(f"No se encontraron imagenes en: {in_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) Limpiar y recortar todas las imagenes.
    sprites = []
    for f in files:
        img = load_and_clean(f, args)
        if img is None:
            print(f"  [!] {f.name}: imagen vacia tras quitar el fondo, se omite")
            continue
        sprites.append([f, img])
        print(f"  {f.name}: personaje de {img.width}x{img.height}px")

    if not sprites:
        sys.exit("Ninguna imagen tenia contenido visible.")

    # 2) Escalar.
    if args.height:
        target = args.height
    elif args.scale == "median":
        target = int(np.median([s[1].height for s in sprites]))
    else:
        target = None

    if target:
        for s in sprites:
            img = s[1]
            factor = target / img.height
            s[1] = img.resize(
                (max(1, round(img.width * factor)), target),
                Image.NEAREST if args.pixel_art else Image.LANCZOS,
            )

    # 3) Calcular anclajes y el lienzo comun.
    anchors = [anchor_point(s[1], args.anchor, args.alpha_threshold, args.feet_band)
               for s in sprites]

    left = max(ax for ax, _ in anchors)
    right = max(s[1].width - ax for s, (ax, _) in zip(sprites, anchors))
    up = max(ay for _, ay in anchors)
    down = max(s[1].height - ay for s, (_, ay) in zip(sprites, anchors))

    half_w = math.ceil(max(left, right)) + args.padding
    need_w = half_w * 2
    need_h = math.ceil(up + down) + args.padding * 2

    if args.canvas:
        canvas_w, canvas_h = args.canvas
        if canvas_w < need_w or canvas_h < need_h:
            print(f"  [!] El lienzo {canvas_w}x{canvas_h} es pequeno; "
                  f"hace falta al menos {need_w}x{need_h}. Algunas partes se cortaran.")
    else:
        canvas_w, canvas_h = need_w, need_h
        if args.pow2:
            canvas_w, canvas_h = next_pow2(canvas_w), next_pow2(canvas_h)

    # Posicion del anclaje dentro del lienzo.
    anchor_x = canvas_w / 2.0
    if args.anchor == "center":
        anchor_y = canvas_h / 2.0
    else:
        anchor_y = canvas_h - args.padding - down if not args.canvas else canvas_h - args.padding

    # 4) Componer y guardar.
    frames = []
    for i, ((src, img), (ax, ay)) in enumerate(zip(sprites, anchors)):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        x = int(round(anchor_x - ax))
        y = int(round(anchor_y - ay))
        canvas.alpha_composite(img, (max(0, x), max(0, y)),
                               (max(0, -x), max(0, -y)))
        name = f"{args.prefix}{i:03d}.png" if args.prefix else f"{src.stem}.png"
        canvas.save(out_dir / name)
        frames.append((name, canvas))

    pivot = {"x": round(anchor_x / canvas_w, 4), "y": round(anchor_y / canvas_h, 4)}
    print(f"\nListo: {len(frames)} imagenes de {canvas_w}x{canvas_h}px en {out_dir}")
    print(f"Pivote (para Unreal/Paper2D): x={anchor_x:.0f}px, y={anchor_y:.0f}px "
          f"(normalizado {pivot['x']}, {pivot['y']})")

    # 5) Hoja de sprites opcional.
    if args.sheet:
        write_sheet(frames, canvas_w, canvas_h, anchor_x, anchor_y, out_dir, args)


def write_sheet(frames, fw, fh, anchor_x, anchor_y, out_dir, args):
    """Genera una spritesheet + JSON en formato TexturePacker (Hash).

    Paper2D la importa directamente: arrastra el .json al Content Browser y
    crea los sprites y el flipbook con el pivote ya configurado.
    """
    cols = args.columns or math.ceil(math.sqrt(len(frames)))
    rows = math.ceil(len(frames) / cols)
    sw, sh = cols * fw, rows * fh
    if args.pow2:
        sw, sh = next_pow2(sw), next_pow2(sh)

    sheet = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    data = {"frames": {}, "meta": {}}
    for i, (name, img) in enumerate(frames):
        x, y = (i % cols) * fw, (i // cols) * fh
        sheet.paste(img, (x, y))
        data["frames"][name] = {
            "frame": {"x": x, "y": y, "w": fw, "h": fh},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh},
            "sourceSize": {"w": fw, "h": fh},
            "pivot": {"x": round(anchor_x / fw, 4), "y": round(anchor_y / fh, 4)},
        }

    base = args.sheet
    data["meta"] = {
        "app": "sprite_aligner",
        "version": "1.0",
        "image": f"{base}.png",
        "format": "RGBA8888",
        "size": {"w": sw, "h": sh},
        "scale": "1",
    }
    sheet.save(out_dir / f"{base}.png")
    with open(out_dir / f"{base}.json", "w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=2)
    print(f"Spritesheet: {base}.png ({sw}x{sh}, {cols} columnas) + {base}.json")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_size(text):
    try:
        w, h = text.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError("usa el formato ANCHOxALTO, p. ej. 512x512")


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Alinea imagenes 2D de un personaje en el mismo sitio y tamano "
                    "para usarlas como sprites en Unreal (Paper2D).")
    p.add_argument("input", help="carpeta con las imagenes (o una sola imagen)")
    p.add_argument("output", help="carpeta donde guardar las imagenes alineadas")

    g = p.add_argument_group("alineacion")
    g.add_argument("--anchor", choices=["feet", "bottom", "mass", "center"], default="feet",
                   help="punto que se alinea en todas las imagenes (defecto: feet = pies)")
    g.add_argument("--feet-band", type=float, default=0.08,
                   help="fraccion inferior de la altura usada para localizar los pies (defecto: 0.08)")

    g = p.add_argument_group("escala")
    g.add_argument("--scale", choices=["none", "median"], default="none",
                   help="none = tamano original; median = todos a la altura mediana")
    g.add_argument("--height", type=int,
                   help="escala todos los personajes a esta altura en px (ignora --scale)")
    g.add_argument("--pixel-art", action="store_true",
                   help="escalado sin suavizado (nearest) para pixel art")

    g = p.add_argument_group("lienzo")
    g.add_argument("--canvas", type=parse_size,
                   help="tamano fijo del lienzo, p. ej. 512x512 (por defecto se calcula solo)")
    g.add_argument("--padding", type=int, default=4, help="margen en px (defecto: 4)")
    g.add_argument("--pow2", action="store_true",
                   help="redondea el lienzo a potencia de 2 (recomendado para texturas de Unreal)")

    g = p.add_argument_group("fondo")
    g.add_argument("--remove-bg", choices=["auto", "always", "never"], default="auto",
                   help="auto = solo si la imagen no tiene transparencia (defecto)")
    g.add_argument("--bg-tolerance", type=float, default=40.0,
                   help="cuanto puede diferir un pixel del color de fondo para borrarse (defecto: 40)")
    g.add_argument("--bg-softness", type=float, default=30.0,
                   help="suavizado del borde al quitar el fondo (0 = borde duro)")
    g.add_argument("--alpha-threshold", type=int, default=10,
                   help="alfa minimo para considerar un pixel parte del personaje (defecto: 10)")
    g.add_argument("--min-island", type=float, default=0.02,
                   help="borra manchas menores que esta fraccion del trozo mayor (0 = desactivar)")

    g = p.add_argument_group("salida")
    g.add_argument("--prefix", help="renombra la salida como PREFIJO000.png, PREFIJO001.png...")
    g.add_argument("--sheet", metavar="NOMBRE",
                   help="genera tambien NOMBRE.png + NOMBRE.json (spritesheet para Paper2D)")
    g.add_argument("--columns", type=int, help="columnas de la spritesheet (defecto: automatico)")

    args = p.parse_args(argv)
    process(args)


if __name__ == "__main__":
    main()
