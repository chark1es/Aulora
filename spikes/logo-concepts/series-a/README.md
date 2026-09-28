# Aulora logo concepts — Series A

Exploration only. These are concept sketches; none of them replaces
`packages/ui-web/src/Logo.tsx` or `packages/ui-native/src/Logo.tsx`, and no app
or package code was touched.

Every mark is a 96×96 vector drawn on a transparent canvas, centred with app-icon
safe margins. The two-tone marks read their colours from two CSS custom
properties — `--ember` (primary) and `--moss` (accent dot) — with Ember/Moss
fallbacks baked in, so the same file can be dropped on either appearance:

| Token | Light | Dark |
| --- | --- | --- |
| `--ember` | `#C2410C` | `#E4571C` |
| `--moss` | `#248A3D` | `#4CD964` |

Each concept ships as `a*.svg` (transparent) and `a*-tile.svg` (the squircle
app-icon treatment: the mark reversed out of an Ember tile). Gallery:
`/tmp/logo-series-a.png` — 512/64/32/16 px on Loam and Linen, the three tiles,
and a one-colour proof on both backgrounds.

## A1 · Threshold — `a1-threshold.svg`, `a1-threshold-tile.svg`

A single clean arched doorway in Ember, held together by a subtle inner
threshold line near the sill and a small Moss speech dot resting in the portal.
It is the idea of Aulora rendered literally: the hall (the arch) and speech (the
dot) meeting at the threshold, where a conversation crosses from outside to in.
**Strengths:** the most legible-on-sight of the three — an unmistakable doorway
that survives down to 16 px as "a dot in an arch", and the thin sill reads as a
deliberate detail at large sizes while quietly dropping out small. **Trade-offs:**
it is the closest to the current mark, so it reads as an evolution rather than a
break; the dot-above-line stack is a touch illustrative and can drift toward a
"face" reading if the sill gets too heavy, so it is kept deliberately thin.

## A2 · A-arch — `a2-arch.svg`, `a2-arch-tile.svg`

The letter A built entirely from the threshold: the apex is a rounded arch, the
counter (negative space) opens as an arched doorway, and the crossbar doubles as
the threshold. One flat Ember fill, no accent needed. It says the word and the
building at once — Aulora, spelled as the room your team talks in. **Strengths:**
the most confident and ownable mark, and the most robust — a single colour and a
single silhouette that stays crisp from 16 to 512 px and needs no second colour to
work; the letterform is geometric and immediately nameable. **Trade-offs:** it is
unambiguously a letter A, so it competes a little with "any A brand", and the
arch idea is carried only by the rounded apex and the arched counter, which is
subtle; it also needs to be seen against a serif/sans "A" lockup before lockup
decisions are final.

## A3 · Halo / Keyhole — `a3-halo.svg`, `a3-halo-tile.svg`

The app's own "threshold aura" turned into a mark: a full Ember ring with a
centred keyhole — a dot over a downward slot — whose core is the Moss speech dot.
The ring is the aura/voice around the room; the keyhole is the door you speak
through. **Strengths:** the most iconic and the strongest app icon — a compact,
centred, near-symmetrical form that holds its shape at every size and looks
engineered on the Ember tile; it ties directly to the existing aura signature in
`apps/web/src/styles/globals.css`. **Trade-offs:** the keyhole can read as a
lightbulb or an eye if the stem grows too fat, so the stem is kept short and
narrow; and a ring-plus-dot is a well-worn composition, so its distinctiveness
rests on the keyhole detail, which thins away at 16 px (leaving a clean dot in a
ring).

## Rendering note

`--ember`/`--moss` are read through inline `style` because CSS custom properties
do not resolve in SVG presentation attributes. Outside a customised context the
fallbacks (light Ember/Moss) apply. For a true one-colour rendering, set both
custom properties to the same value (this is what the gallery's proof rows do).
