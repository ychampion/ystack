# Never use: the AI tells, why, and what instead

A tell is not bad design in itself. Most began as good ideas on good sites and became tells by being
produced by default, everywhere, without a reason. That is why this list bans defaults, not devices,
and why it never names a replacement font, colour or component as *the* answer: every published
"use this instead" list becomes the next wave of tells within months. Replacements are procedures.

Numbers marked † come from taste-skill's study of 247 curated gallery sites (One Page Love, Awwwards
Sites of the Day): share of sites scored 7.5 or higher by the panel against sites scored under 6.5.

`slop-guard` levels: **block** = holds the turn at Stop until fixed or plainly explained; **warn** =
reported on the edit with the line and the reason.

## Contents

1. Composition
2. Surfaces
3. Type
4. Copy
5. Proof and product
6. Ornament and motion
7. Chrome
8. Why removal is not enough

## 1. Composition

| Tell | Why it reads as generated | Instead |
| --- | --- | --- |
| Centred hero, headline over three lines, two buttons, screenshot below | It is the statistical average of every SaaS page | The idea sentence decides the first screen; one primary action named for what it does |
| Logo row, three icon cards, testimonial, pricing, CTA, in that order | The order of a template, not of an argument | The order of your claims; delete sections with no claim |
| Every section the same height and layout | Nothing was decided per section | Each section's composition follows its content; neighbours differ |
| Icon in a tinted square atop each of three cards (slop-guard: warn) | 1% of top sites against 28% of weak ones † | A list set large, a real product fragment per item, a narrative split |
| Bento grid of rounded tiles as the feature section | The 2025 version of the three cards | Tiles only when the cells are truly comparable, with real content in each |

## 2. Surfaces

| Tell | Why | Instead |
| --- | --- | --- |
| Violet/indigo gradients (warn) | First-wave generated look; gradients on 22% of top sites against 52% † | Flat colour; a neutral scrim over a photo is fine |
| Gradient-filled text (**block**) | The most recognisable tell, and half its letters fail contrast | Solid ink; emphasis from words or size |
| Glows, halos, focus rings, coloured shadows (**block**) | The data: shadows on 24% of top sites against 48% † | A flat fill one shade off the ground, spacing; focus by a fill change |
| Glass: blur panels, translucent cards (warn from the second) | A 2024 tell; one blurred sticky bar is the allowance | Opaque surfaces one tone step from the ground |
| Soft drop shadow under every card | Component-library default | No box, or a tone step; shadows only on what truly floats (menus, dialogs) |
| One 12-16 px radius on everything; nested cards | The weak-site default radius † | Square or fully round, decided once; no card inside a card |
| Rounded card with a thick coloured left border (warn) | Stock generated component | A heading, a tone step; left borders for real blockquotes only |
| Cream + terracotta, near-black + neon, as defaults | The "warm editorial" cure became the third wave | Colours from the subject's own world |

## 3. Type

| Tell | Why | Instead |
| --- | --- | --- |
| Nunito, Quicksand, Comfortaa, Varela Round, Poppins, Figtree, DM Sans as the UI face (**block**) | The "friendly" generated face | One crisp neutral sans with character, or the brand's own (`.slop-guard.json` `brandFonts`) |
| Default Inter, Roboto or system-ui as the page face (**block**; system-ui warns) | The face nobody chose | As above. Inter as a fallback in the stack is fine |
| Three faces or more; mono as a "technical voice" | No system | One sans; mono only for code and data |
| Nine near-equal sizes | No hierarchy | Three to five sizes far apart; headline-to-body ratio around 4 or more |
| One word in italic serif, colour or underline | The 2025 accent-word move | One face, one colour; the words carry the emphasis |
| Placeholder text in another face or italic | Looks like a different product | Same face as the body, muted colour |

## 4. Copy

| Tell | Why | Instead |
| --- | --- | --- |
| unlock, supercharge, seamless, elevate, effortless, cutting-edge, revolutionize, game-changer, all-in-one (warn) | Words that could sell anything sell nothing | A concrete noun and a number: "Wakes in 0.6 s" |
| "Welcome to X", "In today's...", "not just X, it's Y" (warn) | Formula openings | Say what it is in under ten words |
| Tricolon slogans; a forest of em dashes | Rhythm instead of meaning | One plain sentence; commas and full stops |
| "Get started" / "Learn more" alone (warn) | Says nothing about what happens next | "Start a sandbox", "See pricing"; a stock label is fine in a nav beside a specific action |
| Performative section labels ("Field notes", "Quietly trusted by") | Costume | Plain section names |

## 5. Proof and product

| Tell | Why | Instead |
| --- | --- | --- |
| Lorem ipsum, placeholder image services, stock avatars, "Jane Doe, CEO at Acme" (**block**) | Unfinished, and fake | Real content, or leave the slot out |
| "Trusted by 10,000+ teams", star rows, vanity counters (**block** for invented counts; warn for unsourced numbers) | Persuades only when true and checkable | A real number with a source (`slop-ok: source=<url>`), named customers with one-line outcomes, or nothing |
| Fake logos, fake YC or press badges | Dishonest | Real logos with permission |
| Grey-bar dashboards, lorem numbers in a product shot | The weakest picture a software page can have | A real UI fragment built as a working component, with real data that adds up |
| AI images of people as customers or team; AI "product shots" | Dishonest, and readers can tell | Real photos, or none; generated places and materials only, listed in the report |

## 6. Ornament and motion

| Tell | Why | Instead |
| --- | --- | --- |
| Blobs, wavy dividers, crosshairs, crop marks, selection handles | Ornament with no job | Remove; fill the space with scale or real content |
| Pulsing "live" dots, micro-meta strings (`A · B · C`), clocks and coordinates that say nothing | Agency costume | Remove, unless the value is real and useful (boat's tmux bar shows real region and time) |
| Emoji as icons, bullets or heading decoration (warn) | Template | Words, a real picture, or a drawn icon in the page's own line weight |
| Fade-up on every block; hover-lift on every card (warn at four or more) | Motion on autopilot | One signature move tied to the story |
| Bounce or overshoot easing; `transition: all` (warn) | Template; `all` also animates layout you did not mean to | Standard easing; transition named properties |
| No reduced-motion fallback (warn once per project) | Makes some visitors ill | `prefers-reduced-motion: reduce` keeps content, drops travel |

## 7. Chrome

Dashboard furniture on a landing page reads as an internal tool: theme or motion toggles in the hero,
Pause buttons, state readouts, margin rails, time gutters, status-pill legends, "illustration" tags,
keyboard hints, roadmap or "building" labels, internal "built / reviewed" tables. A landing page sells
in seconds; engineering honesty belongs in docs, pricing fine print and the changelog. An app screen
is different: there, quiet borders, small labels and repeated panels are normal.

## 8. Why removal is not enough

A page with every tell removed and nothing put in their place is an empty page with good manners, and
that is a tell too. The tells were filling a gap where an idea should have been. Fill it first: the idea
from the subject, the full real content, the product shown working, pictures of this subject's world,
type set larger. Then remove.
