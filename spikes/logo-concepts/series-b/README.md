# Aulora logo marks — series B

Three concept directions for a new Aulora mark, explored alongside the sibling
`series-a` set (which covers arch / monogram / portal). These avoid those exact
moves. All marks are `viewBox="0 0 96 96"`, transparent, centred inside a ~12px
safe margin, drawn in Ember with an optional single Moss accent, and built from
solid fills and true negative space so each one survives a one-colour rendering
and scales from 16px to 512px. Rendered proof: `/tmp/logo-series-b.png`.

Files per concept: `bN-*.svg` (the mark) and `bN-*-tile.svg` (the squircle
app-icon treatment, mark reversed out of an Ember tile). The SVGs expose
`--ember` / `--moss` custom properties with light-palette fallbacks, so a host
can swap the accent per theme without editing geometry.

## B4 — Speech-arch (`b4-speech-arch.svg`)

A rounded speech bubble whose lower-left tail is also a doorway: an arched
opening is cut through the bubble as negative space and seated on an Ember sill,
while the tail drops away as the classic chat pointer. It reads simultaneously
as "talk" and "enter" — the pointer is the threshold. **Strengths:** the most
immediately legible of the three (it is unmistakably a chat bubble at every
size, with the door detail resolving at 512 and dissolving gracefully to a clean
bubble at 16); the single Moss dot reads as a new-message indicator. **Trade-offs:**
the doorway is a detail rather than the primary silhouette, so the "enter" half
of the metaphor is felt more at large sizes; the mark is wide, so it wants a
little more headline space than the others.

## B5 — Voices (`b5-voices.svg`)

One hall (a single Ember arch) holding three arched doorways carved out by two
piers — many voices gathered under one roof, with the tallest bay in the centre
and a Moss dot standing in it as the voice that carries. **Strengths:** the
strongest "community / self-hosted hall" story and the most distinctive
silhouette; genuine negative space; holds up as a one-colour stamp and reads
clearly down to ~20px. **Trade-offs:** at small sizes the three bays fuse and the
form can tip toward "gatehouse/castle" rather than "conversation", so the
framing copy matters; the two piers add visual weight, making it the heaviest of
the three.

## B6 — Initial A (`b6-initial.svg`)

A geometric, rounded **A** drawn as three heavy round-capped strokes, with a
small speech dot carved out of the apex as true negative space. The dot sits in
the apex opening (drawn with an SVG mask for the knockout); the **A** is the
brand, the dot the voice. **Strengths:** the most "app-icon energy" of the set —
a bold, confident monogram that is instant at 16px, works as pure negative-space
knockout, and has the cleanest single-colour behaviour. **Trade-offs:** the
carved dot closes up at 16–20px, so it becomes a solid **A** (fine, but the
"speech" note is lost small); it is the least self-explanatory without brand
context, and a monogram direction is closer to the series-A territory even
though the construction (rounded strokes + apex knockout) is different.

> Naming note: the brief labels this direction "Initial K" but describes it as a
> monogram "built from an A". Since the brand is Aulora, the mark is drawn as an
> **A**; rename freely if "K" was intentional.
