# Devices: when one earns its place

The test for every device is one sentence: **what does it carry?** If the answer is information
(a real command, a real category, a real sequence, a real grid of comparable things) or the product's
own world (the name, the material, the place), keep it and use it consistently. If the answer is
"it looks designed" or "it feels technical", cut it. Write the sentence in your notes; if you cannot,
the device is costume.

## Contents

1. The devices one by one
2. One technique, used everywhere
3. The ASCII / technical mode
4. Motion

## 1. The devices one by one

**Monospace.** Earns it for literal commands (`$ boat new my-app`), their output
(`systemctl is-active → 4 active`), IDs, prices and figures in a comparison (boat's twelve competitors,
each with $/mo, a multiple and a footnote), keyboard keys, file paths. Body copy, headings and labels
stay in the sans. A mono string must be true: never a fake command, never `~/` decoration. Tabular
figures in the sans are often better than mono for aligned numbers.

**Hairlines and 1 px grids.** Earn it when they separate a real grid of comparable cells (Maritime's
product cells: one box, two boxes, a swarm, each with a price), a table, a list of rows to scan, a form
field. One hairline, low contrast, the same hue as the surface. Costume: a rule under every heading,
an outlined box around a single item, ruled "broadsheet" columns, crop marks.

**Index numbers.** Earn it when the order is real (a three-step install, `Step 1 of 3` in a demo that
types itself) or the number is an identifier (`#8812 Dallas → Tulsa $1,450`). Use a real `<ol>` when it
is a list. Costume: `01 / 02 / 03` over sections that could be shuffled.

**Small uppercase labels.** Earn it when each names a real category: Scale's `APPLICATIONS`, `COMPANY`,
`PUBLIC SECTOR`, footer column headers, a table's column names. One or two per view, readable size.
Costume: an eyebrow above every heading (slop-guard warns at three in a file), "New ·" chips, pill
badges above the hero headline (pill badges: 14% of top sites against 34% of weak ones in taste-skill's
study).

**Floating or pill nav.** Earns it when it solves something: Maritime's full-width bar becomes a pill
only once you scroll, so content shows around it. Costume: a pill as the default nav shape with blur.
Default nav: wordmark, three to five plain links, one action.

**Dark themes and single-hue palettes.** Earn it when the subject lives there: boat's night sea in one
cobalt with lavender tone steps; a terminal product. Costume: dark as the shortcut to "premium". One
ground, one ink, one accent, or one hue in many values.

**Rounded cards.** Fine when the cards are real objects (a sandbox, a plan, a load) with real content,
and the radius is decided once. Not as the container for every block.

**Imagery.** Earns it when it is the product working, the real place, real footage of the real work
(Scale's surgeon, ultrasound with its `24 fps` readout), or source material that code transforms
(Maritime's dithered sea). One dominant picture beats six small ones. Never a stand-in for content you
do not have.

## 2. One technique, used everywhere

The three studied sites each choose one technique and carry it into every section: Maritime dithers its
hero, every product icon and the feature strip; boat draws the scene, the calculator fleet and the
footer status bar from one pixel language; Scale's contour lines, keypoints and translucent planes all
say "data labelling". Pick yours from the idea sentence, then check the pricing, FAQ, empty states and
footer carry it too. The commonest failure, even on good sites, is a distinctive first screen followed
by stock blocks.

## 3. The ASCII / technical mode

**When:** proposed by Claude for developer, agent or infrastructure products, confirmed by the user.
Never the default; never for consumer or regulated brands (health, finance, children).

**Vocabulary (pick one):**
- **Halftone or ordered dithering** of a photo or render (Maritime). Make or find a source image, then
  dither it in code: a canvas pass with a Bayer matrix, or a fragment shader. Keep the source too.
- **Pixel art** drawn in code (boat): canvas or SVG rects on an integer grid, one hue in four to six
  values, scaled with `image-rendering: pixelated`. Animatable and data-driven (one boat per VM).
- **True ASCII art** as text: precomputed from a source image (luminance to a character ramp like
  ` .:-=+*#%@`), set in a `<pre>` with `aria-label` describing the picture and `aria-hidden` on the
  glyphs if it is decorative. Size it so a phone shows it whole or crops it on purpose.
- **Wireframe, contour or keypoint overlays** on a real picture (Scale): edge detection or hand-placed
  SVG paths, dotted leader lines to labels that name real things.
- **Terminal fragments:** real commands with a copy button, install tabs per OS (macOS/Linux/Windows),
  a demo that types itself, a tmux-style status bar with true values.

**Rules:**
- One technique per site, everywhere. Body copy stays in the sans; every mono string is literally true.
- Generated in code, not baked into a JPEG, so it stays crisp, small, themeable and animatable. A
  generated image is fine as the *source* (`make-media`, then its dither recipe).
- Reads well at 375 px: test it. Animation pauses under `prefers-reduced-motion`.
- The look still carries information (boats count VMs; keypoints mark real anatomy).
- Set `{"mode":"technical"}` in `.slop-guard.json`; every other slop-guard rule still applies.

## 4. Motion

Motion earns its place when it tells the story (headline words that resolve as you scroll, planes that
drift apart to show the layers of a system, a fleet that resizes when the slider moves, a typing demo)
or answers the user (press, hover, focus, state change). Transform and opacity only. Every move has a
reduced-motion fallback that keeps the content and drops the travel. Costume: the same fade-up on every
block, hover-lift on every card, bounce easing, loops that mean nothing, content hidden until a script
runs.
