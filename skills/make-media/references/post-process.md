# Post-processing generated media

All commands use ffmpeg (with libwebp, libaom-av1, libx264, libvpx-vp9 and the palette filters) and
were run on real frames. Run them from the project root; `IN` is the raw file in `assets/generated/`.

## Contents

1. Crop and compress images
2. Ordered dithering (halftone)
3. ASCII art
4. Web video and poster
5. Checking the result

## 1. Crop and compress images

Crop to the layout's ratio first (the `min()` form works whatever the source ratio), then size to the
largest width the layout shows, then encode. Make two widths for `srcset`.

```bash
# 16:9 crop, at most 1600 px wide, WebP at quality 78
ffmpeg -y -i "$IN" -vf "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale='min(1600,iw)':-2" -c:v libwebp -quality 78 public/hero-1600.webp
ffmpeg -y -i "$IN" -vf "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale='min(800,iw)':-2"  -c:v libwebp -quality 78 public/hero-800.webp
# AVIF, smaller again, where the stack serves it
ffmpeg -y -i "$IN" -vf "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale='min(1600,iw)':-2" -c:v libaom-av1 -still-picture 1 -crf 32 -b:v 0 public/hero-1600.avif
```

Other ratios: 4:5 is `crop='min(iw,ih*4/5)':'min(ih,iw*5/4)'`; 1:1 is `crop='min(iw,ih)':'min(iw,ih)'`.
Off-centre crops add `:x:y` (for example `:0:0` for the top left). On the page: `<picture>` with the
AVIF and WebP sources, explicit `width` and `height` (no layout shift), `loading="lazy"` below the fold,
real `alt` text. On a test frame, WebP came to about 45% of the JPEG and AVIF to about 25-40%.

## 2. Ordered dithering (halftone)

**Static, in ffmpeg.** Use a fixed palette of the page's own two colours (ink and ground), not
`palettegen` (which picks muddy greys). Raise contrast first; a source with a full tonal range gives the
best pattern.

```bash
INK=0xc9d1d9; GROUND=0x0d1117
ffmpeg -y -i "$IN" -f lavfi -i "color=c=$GROUND:s=1x1" -f lavfi -i "color=c=$INK:s=1x1" -filter_complex \
  "[1][2]hstack=inputs=2,scale=16:16:flags=neighbor,format=rgb24[pal];[0]scale=960:-1,format=gray,eq=contrast=1.3:brightness=0.05,format=rgb24[src];[src][pal]paletteuse=dither=bayer:bayer_scale=1" \
  -frames:v 1 public/hero-dither.png
```

`bayer_scale` 0-5 sets the pattern size (higher is coarser). Keep the PNG (two colours compress very
well) and display it at 1:1 or an integer multiple with `image-rendering: pixelated`.

**Runtime, in a canvas** (themeable and animatable; the source image stays one file). A 4×4 Bayer
ordered dither of an `ImageData`, pure and fast:

```js
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Two-tone ordered dither in place. ink/ground are [r, g, b]; gain/lift adjust contrast and brightness. */
function ditherBayer(img, ink, ground, gain = 1.2, lift = 0) {
  const { data, width, height } = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const v = Math.min(1, Math.max(0, (lum - 0.5) * gain + 0.5 + lift));
      const c = v > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? ink : ground;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return img;
}
// Usage: draw the source small (e.g. 320 px wide) into a canvas, getImageData, ditherBayer, putImageData,
// then scale the canvas up with CSS `image-rendering: pixelated`. Read ink and ground from CSS variables
// so a theme switch re-dithers. Redraw only on resize or theme change; pause any animation under
// prefers-reduced-motion.
```

## 3. ASCII art

```bash
node <make-media>/scripts/ascii.mjs "$IN" --cols 96 --invert --out src/ascii/hero.txt
```

`--invert` for light characters on a dark ground. `--ramp` changes the characters (dense last, e.g.
`" .:-=+*#%@"` or `" .·:░▒▓█"` if the face has the block glyphs). Import the text at build time and set
it in `<pre aria-label="<what the picture shows>">`, in the page's mono face, `line-height: 1`,
`font-size` chosen so the art fits the column (cols × about 0.6 em). At 375 px either scale the font down
(`font-size: calc(100vw / 96 / 0.6)`) or make a second, narrower art at `--cols 48`.

## 4. Web video and poster

```bash
# muted H.264 loop, 1280 wide, about 1-2 MB for 8 s; plus VP9 WebM; plus a poster frame
ffmpeg -y -i "$IN" -an -vf "scale='min(1280,iw)':-2,fps=24" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart public/hero.mp4
ffmpeg -y -i "$IN" -an -vf "scale='min(1280,iw)':-2,fps=24" -c:v libvpx-vp9 -crf 36 -b:v 0 public/hero.webm
ffmpeg -y -ss 0.5 -i "$IN" -frames:v 1 -vf "scale='min(1600,iw)':-2" -c:v libwebp -quality 78 public/hero-poster.webp
```

`<video autoplay muted loop playsinline poster="hero-poster.webp">` with both sources; under
`prefers-reduced-motion: reduce`, do not autoplay (show the poster, offer a play button). Keep the native
audio only when sound is the point and the visitor starts it.

## 5. Checking the result

- Open every processed file with the Read tool and look at it at the size it will show.
- `ffprobe -v error -show_entries stream=width,height -of csv=p=0 <file>` for dimensions; `ls -la` for
  weight.
- Then run the `taste` verification on the page (screenshots at 1440, 768, 375) and look again.
