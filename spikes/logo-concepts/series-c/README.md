# Aulora logo marks — series C (compact)

Four compact, modern concepts for a new Aulora mark, drawn on a tight
`viewBox="0 0 48 48"` so each one is a real 1:1 app icon rather than a tall
doorway. They follow the sibling `series-a` and `series-b` sets but deliberately
avoid their exact moves (no tall arch, no three-bay hall, no circle-registered
keyhole). Every mark sits inside a ~5px safe margin, is built from geometric
primitives (circles, rounded rects, straight strokes), carries Ember as the
primary shape and at most one Moss accent dot, and reads in one colour because
the detail is carried by true negative space.

Colours are exposed as `--ember` / `--moss` custom properties (through inline
`style`, since custom properties do not resolve in SVG presentation attributes)
with the **light-palette** fallbacks baked in: `#C2410C` / `#248A3D`. A host can
set the two variables on an ancestor to get the dark pair (`#E4571C` /
`#4CD964`). Files per concept: `cN-*.svg` (transparent mark) and
`cN-*-tile.svg` (the squircle app-icon treatment, mark reversed out of an Ember
tile, dot kept Moss). Rendered proof: `/tmp/logo-series-c.png` at 512/64/32/20/16
px on Loam and Linen, plus the tiles.

## C1 · Monogram A — `c1-monogram.svg`

A wide, low, geometric **A** drawn as two heavy round-capped legs and a low
crossbar, with a real triangular counter and an open base. It is the most
confident lettermark of the set: the brand initial itself, drawn with app-icon
weight. **Strengths:** the most legible mark at 16 px (an A is unmistakable at
any size), pure monochrome by construction (one Ember fill, no accent needed),
and the widest optical footprint of the four, so it sits naturally on the Ember
tile. **Trade-offs:** it is the least literal about the hall/threshold metaphor —
the story lives in the name, not the glyph — and it is the closest in spirit to
`series-b`'s Initial A, though the construction (filled strokes + open counter,
no carved dot) is different.

## C2 · Portal Slab — `c2-portal-slab.svg`

A dense rounded-square "wall" with an arched doorway carved straight through it
and one Moss voice resting in the mouth of the arch. The slab is itself the
shape of an app-icon tile, so the mark fills the icon edge to edge while the
arched void keeps it from reading as a generic rounded square. **Strengths:**
the strongest single-silhouette app icon — a compact, high-contrast object that
holds together from 512 down to 16 px — and the clearest "threshold" statement
of the four. **Trade-offs:** at 16 px the arch mouth and the Moss dot begin to
merge into one notch, so the dot has to stay small; the form is also the least
literal "speech" of the set.

## C3 · Portal Ring — `c3-portal-ring.svg`

A thick, concentric **squircle** ring — the app's existing "threshold aura"
turned into one bold object — holding a single Moss voice at dead centre. Outer
and inner rounded rects share corner centres, so the wall is a uniform 9 px at
every point. **Strengths:** the most app-icon-native mark of the set: centred,
near-symmetric, dense, and trivially rasterisable from two rounded rects and a
circle; it ties directly to the aura signature already used in the web and
native threshold screens. **Trade-offs:** a ring-plus-dot is a well-worn
composition, so its distinctiveness rests on the squircle geometry and the
uniform weight rather than on the idea; in one colour the dot can read as a
"record" button.

## C4 · Speech Chip — `c4-speech-chip.svg`

A compact rounded-square speech bubble with a single notched tail and one Moss
voice. It is the plainest and friendliest read of "talk" in the set — no arch
detail, just a dense chat glyph — and pairs the square bubble language with the
same squircle silhouette as the tiles. **Strengths:** immediately legible as
chat at every size, with a clear silhouette and a clean one-colour fallback
(bubble + dot). **Trade-offs:** the least distinctive — a bubble is the default
shape of every chat product — and it says "messages" but not "hall" or "Aulora";
the tail is the only thing keeping it from reading as a generic notification
chip.
