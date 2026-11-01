"""
Generates an animated GIF (and optional MP4-ready frame folder) of the TransChap
logo on a dark background with a warm glow trail running around its border,
followed by a "COMING SOON" reveal.

Usage:
    python3 scripts/make_logo_glow_gif.py

Outputs:
    public/animations/transchap-coming-soon.gif
    frontend/public/animations/transchap-coming-soon.gif
"""

from __future__ import annotations

import io
import math
import os
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
LOGO_SVG = ROOT / "frontend" / "public" / "logo.svg"
OUT_DIR_PUBLIC = ROOT / "public" / "animations"
OUT_DIR_FRONTEND = ROOT / "frontend" / "public" / "animations"

# Canvas
W, H = 640, 640
BG = (26, 18, 8)            # --ink #1A1208
CREAM = (245, 239, 230)     # --cream-100
ACCENT = (208, 104, 72)     # --terra-400 #D06848
ACCENT_HOT = (240, 160, 110)  # lighter glow core
GLOW_TRAIL = (208, 104, 72)

# Logo placement
LOGO_SIZE = 280
LOGO_BOX_PAD = 50        # padding from logo to rounded-rect frame
FRAME_RADIUS = 46
FRAME_STROKE = 3

# Animation timing
FPS = 20
FRAME_DURATION_MS = int(1000 / FPS)

DUR_GLOW = 1.7           # seconds for glow to travel the perimeter
DUR_AFTER = 0.25         # hold after glow completes (before text starts)
DUR_TEXT_FADE = 0.6      # seconds to fade in COMING SOON
DUR_HOLD = 1.4           # hold the final state
TOTAL_DUR = DUR_GLOW + DUR_AFTER + DUR_TEXT_FADE + DUR_HOLD

NUM_FRAMES = int(round(TOTAL_DUR * FPS))


# ---------------------------------------------------------------------------
# Logo: render the SVG at high quality, recoloured to cream + accent
# ---------------------------------------------------------------------------

def load_logo(size: int) -> Image.Image:
    """Render the SVG with brand-appropriate colors for a dark background."""
    raw_svg = LOGO_SVG.read_text(encoding="utf-8")
    # Recolor for dark background: brown outlines -> cream, accent sparkle stays
    themed = (
        raw_svg
        .replace('stroke="#6b2e14"', 'stroke="#F5EFE6"')
        .replace('fill="#6b2e14"', 'fill="#F5EFE6"')
        .replace('fill="#d06848"', 'fill="#F0A06E"')
    )
    png_bytes = cairosvg.svg2png(
        bytestring=themed.encode("utf-8"),
        output_width=size * 3,   # super-sample for crisp edges
        output_height=size * 3,
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    img = img.resize((size, size), Image.LANCZOS)
    return img


# ---------------------------------------------------------------------------
# Rounded-rect perimeter sampler
# ---------------------------------------------------------------------------

def rounded_rect_path(x: float, y: float, w: float, h: float, r: float,
                     n: int = 1200) -> list[tuple[float, float]]:
    """Return `n` points uniformly spaced along the perimeter of a rounded rect."""
    # Lengths of each segment
    straight_h = w - 2 * r           # horizontal straight length
    straight_v = h - 2 * r           # vertical straight length
    arc_len = (math.pi / 2) * r      # quarter-circle arc length
    total = 2 * straight_h + 2 * straight_v + 4 * arc_len

    pts: list[tuple[float, float]] = []
    for i in range(n):
        d = (i / n) * total
        # Start: top edge, after the top-left arc — at (x+r, y)
        if d < straight_h:
            t = d
            pts.append((x + r + t, y))
            continue
        d -= straight_h

        # Top-right arc: center (x+w-r, y+r), angle -90deg -> 0deg
        if d < arc_len:
            theta = -math.pi / 2 + (d / arc_len) * (math.pi / 2)
            pts.append((x + w - r + math.cos(theta) * r,
                        y + r + math.sin(theta) * r))
            continue
        d -= arc_len

        # Right edge: (x+w, y+r) -> (x+w, y+h-r)
        if d < straight_v:
            t = d
            pts.append((x + w, y + r + t))
            continue
        d -= straight_v

        # Bottom-right arc: center (x+w-r, y+h-r), angle 0 -> 90
        if d < arc_len:
            theta = (d / arc_len) * (math.pi / 2)
            pts.append((x + w - r + math.cos(theta) * r,
                        y + h - r + math.sin(theta) * r))
            continue
        d -= arc_len

        # Bottom edge: (x+w-r, y+h) -> (x+r, y+h)
        if d < straight_h:
            t = d
            pts.append((x + w - r - t, y + h))
            continue
        d -= straight_h

        # Bottom-left arc: center (x+r, y+h-r), angle 90 -> 180
        if d < arc_len:
            theta = math.pi / 2 + (d / arc_len) * (math.pi / 2)
            pts.append((x + r + math.cos(theta) * r,
                        y + h - r + math.sin(theta) * r))
            continue
        d -= arc_len

        # Left edge: (x, y+h-r) -> (x, y+r)
        if d < straight_v:
            t = d
            pts.append((x, y + h - r - t))
            continue
        d -= straight_v

        # Top-left arc: center (x+r, y+r), angle 180 -> 270
        theta = math.pi + (d / arc_len) * (math.pi / 2)
        pts.append((x + r + math.cos(theta) * r,
                    y + r + math.sin(theta) * r))

    return pts


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def ease_in_out(t: float) -> float:
    """Smoothstep for nicer motion."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def draw_base_frame(logo: Image.Image,
                    frame_box: tuple[int, int, int, int]) -> Image.Image:
    """Background, dim border, and centered logo. Returned RGBA image."""
    img = Image.new("RGBA", (W, H), (*BG, 255))

    # Subtle radial warm highlight (downscale-blur-upscale = fast & soft)
    vignette = Image.new("RGBA", (W // 8, H // 8), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    rad = 280 // 8
    cx_v, cy_v = (W // 8) / 2, (H // 8) / 2
    vd.ellipse(
        (cx_v - rad, cy_v - rad, cx_v + rad, cy_v + rad),
        fill=(70, 36, 20, 90),
    )
    vignette = vignette.filter(ImageFilter.GaussianBlur(8))
    vignette = vignette.resize((W, H), Image.BILINEAR)
    img.alpha_composite(vignette)

    draw = ImageDraw.Draw(img, "RGBA")

    x0, y0, x1, y1 = frame_box
    draw.rounded_rectangle(
        (x0, y0, x1, y1),
        radius=FRAME_RADIUS,
        outline=(90, 50, 32, 160),
        width=FRAME_STROKE,
    )

    lx = (W - logo.width) // 2
    ly = (H - logo.height) // 2 - 24
    img.alpha_composite(logo, (lx, ly))
    return img


def draw_glow_trail(base: Image.Image,
                    perimeter: list[tuple[float, float]],
                    head_idx: int,
                    trail_len: int) -> Image.Image:
    """Draw a comet/glow trail along the perimeter, head at `head_idx`."""
    # Two layers:
    #   `wide`  – broad soft halo for bloom (big radii, accent color)
    #   `sharp` – bright hot core dots (small radii, almost white)
    wide = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sharp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wide)
    sd = ImageDraw.Draw(sharp)

    n = len(perimeter)
    for k in range(trail_len):
        idx = (head_idx - k) % n
        x, y = perimeter[idx]
        t = 1.0 - (k / max(1, trail_len - 1))  # 1 at head, 0 at tail
        # Wide accent halo (will be blurred for bloom)
        halo_r = 26 * t + 8
        halo_a = int(220 * t * t)
        if halo_a > 0:
            wd.ellipse(
                (x - halo_r, y - halo_r, x + halo_r, y + halo_r),
                fill=(*ACCENT, halo_a),
            )
        # Bright hot core (stays sharp on top)
        core_r = 4 * t + 1.5
        core_a = int(255 * t)
        if core_a > 0:
            sd.ellipse(
                (x - core_r, y - core_r, x + core_r, y + core_r),
                fill=(255, 235, 200, core_a),
            )

    # Blur the wide halo to create a luminous bloom
    small = wide.resize((W // 3, H // 3), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(4))
    bloom = small.resize((W, H), Image.BILINEAR)

    out = base.copy() if base.mode == "RGBA" else base.convert("RGBA")
    # Stack: bloom underneath, then a less-blurred mid layer, then sharp cores.
    out.alpha_composite(bloom)
    # A second pass of the wide layer with slight blur for mid-tone glow.
    mid = wide.filter(ImageFilter.GaussianBlur(3))
    out.alpha_composite(mid)
    out.alpha_composite(sharp)
    return out


def get_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


def draw_coming_soon(img: Image.Image, alpha: float,
                     frame_box: tuple[int, int, int, int]) -> Image.Image:
    """Fade in 'COMING SOON' below the logo with rising motion."""
    if alpha <= 0:
        return img

    out = img.convert("RGBA").copy()

    rise = (1 - alpha) * 12
    text = "COMING SOON"
    font = get_font(38, bold=True)
    tmp_draw = ImageDraw.Draw(out)
    bbox = tmp_draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    cx = W // 2
    cy = frame_box[3] + 50 + rise
    tx = cx - tw // 2
    ty = cy - th // 2

    # Soft warm glow behind text via downscale-blur-upscale (fast)
    glow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    gd.text((tx, ty), text, font=font, fill=(*ACCENT, int(170 * alpha)))
    small = glow_layer.resize((W // 4, H // 4), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(2))
    glow_layer = small.resize((W, H), Image.BILINEAR)
    out.alpha_composite(glow_layer)

    # Hairline separator dots above the text
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    dot_y = frame_box[3] + 22 + rise
    for dx in (-36, 0, 36):
        a = int(200 * alpha)
        d.ellipse(
            (cx + dx - 2, dot_y - 2, cx + dx + 2, dot_y + 2),
            fill=(*CREAM, a),
        )
    d.text((tx, ty), text, font=font, fill=(*CREAM, int(255 * alpha)))

    tagline = "Something special is brewing."
    tag_font = get_font(17)
    tb = d.textbbox((0, 0), tagline, font=tag_font)
    tag_w = tb[2] - tb[0]
    d.text(
        (cx - tag_w // 2, ty + th + 22),
        tagline,
        font=tag_font,
        fill=(220, 200, 180, int(220 * alpha)),
    )

    out.alpha_composite(layer)
    return out


# ---------------------------------------------------------------------------
# Top-level frame builder
# ---------------------------------------------------------------------------

def build_frames() -> list[Image.Image]:
    logo = load_logo(LOGO_SIZE)

    # Compute the rounded-rect frame box that surrounds the logo
    cx, cy = W // 2, H // 2 - 30
    half = LOGO_SIZE // 2 + LOGO_BOX_PAD
    frame_box = (cx - half, cy - half, cx + half, cy + half)
    perimeter = rounded_rect_path(
        frame_box[0], frame_box[1],
        frame_box[2] - frame_box[0],
        frame_box[3] - frame_box[1],
        FRAME_RADIUS,
        n=1600,
    )

    n_glow = int(round(DUR_GLOW * FPS))
    n_after = int(round(DUR_AFTER * FPS))
    n_text = int(round(DUR_TEXT_FADE * FPS))
    n_hold = NUM_FRAMES - n_glow - n_after - n_text

    frames: list[Image.Image] = []

    base = draw_base_frame(logo, frame_box)

    trail_len = 70  # length of glow comet tail

    # ── Phase 1: glow runs around the border ──
    for i in range(n_glow):
        t = i / max(1, n_glow - 1)
        eased = ease_in_out(t)
        head_idx = int(eased * (len(perimeter) - 1))
        frames.append(draw_glow_trail(base, perimeter, head_idx, trail_len))
        if (i + 1) % 5 == 0 or i == n_glow - 1:
            print(f"  glow: {i + 1}/{n_glow}", flush=True)

    # ── Phase 2: brief pause (glow vanishing) ──
    for i in range(n_after):
        t = i / max(1, n_after - 1)
        remaining = int((1 - t) * trail_len)
        head_idx = len(perimeter) - 1
        if remaining <= 0:
            frames.append(base)
        else:
            frames.append(draw_glow_trail(base, perimeter, head_idx, remaining))
    print(f"  after: {n_after} frames", flush=True)

    # ── Phase 3: COMING SOON fades in ──
    for i in range(n_text):
        a = ease_in_out((i + 1) / n_text)
        frames.append(draw_coming_soon(base, a, frame_box))
    print(f"  text fade: {n_text} frames", flush=True)

    # ── Phase 4: hold final state ──
    final = draw_coming_soon(base, 1.0, frame_box)
    for i in range(n_hold):
        frames.append(final)
    print(f"  hold: {n_hold} frames", flush=True)

    return frames


# ---------------------------------------------------------------------------
# Encode & save
# ---------------------------------------------------------------------------

def save_gif(frames: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Build one global adaptive palette from a representative frame mid-glow so
    # the warm-orange tones stay vivid throughout the animation.
    rgb_frames = [f.convert("RGB") for f in frames]
    reference = rgb_frames[len(rgb_frames) // 2 - 5]
    palette_img = reference.convert(
        "P", palette=Image.ADAPTIVE, colors=200
    )
    palette_frames = [
        f.quantize(palette=palette_img, dither=Image.FLOYDSTEINBERG)
        for f in rgb_frames
    ]
    palette_frames[0].save(
        path,
        save_all=True,
        append_images=palette_frames[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )


def save_webp(frames: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb_frames = [f.convert("RGBA") for f in frames]
    rgb_frames[0].save(
        path,
        save_all=True,
        append_images=rgb_frames[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        quality=85,
        method=6,
    )


def main() -> None:
    print(f"Rendering {NUM_FRAMES} frames at {FPS}fps "
          f"({TOTAL_DUR:.2f}s total) ...")
    frames = build_frames()
    print(f"Built {len(frames)} frames.")

    for out_dir in (OUT_DIR_PUBLIC, OUT_DIR_FRONTEND):
        gif_path = out_dir / "transchap-coming-soon.gif"
        webp_path = out_dir / "transchap-coming-soon.webp"
        save_gif(frames, gif_path)
        save_webp(frames, webp_path)
        print(f"Wrote {gif_path} ({gif_path.stat().st_size // 1024} KB)")
        print(f"Wrote {webp_path} ({webp_path.stat().st_size // 1024} KB)")

    # Also keep a static poster of the final frame for og:image use
    poster_path = OUT_DIR_PUBLIC / "transchap-coming-soon-poster.png"
    frames[-1].save(poster_path, "PNG")
    print(f"Wrote {poster_path}")


if __name__ == "__main__":
    main()
