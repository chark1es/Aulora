# Tier-2 web — bounded message-history window (W4)

Branch: `t3/scale-resource-optimization`
Scope: the **web** client only (`apps/web`). No Convex/backend or API change;
`apps/mobile` and `packages/core` are untouched, so their required checks are
unaffected.

## Finding

`use-channel.ts` walked older history page by page (100 roots each) with Convex
`continueCursor`s but **never evicted** any page. `messages` concatenated every
loaded older page plus the live tail, so a user who scrolled back through a long
channel kept thousands of `<article>` rows mounted for the life of the view —
unbounded DOM, RAM and re-render cost (rows are already memoized, but the row
count itself grows without bound).

## What changed

A **bounded sliding window** over history, with no virtualizer.

### The cap

`MAX_RETAINED_PAGES = 12` older pages, i.e. the live tail plus up to ~1,200
messages mounted at once (the exact count varies with the last page, which can
be short). This is deliberately generous: 99% of sessions never load 12 pages
of history, so the cap only engages for marathon readers.

### The eviction rule

Older pages are stored oldest-loaded-last. When a load pushes the array past
`MAX_RETAINED_PAGES`, the effect in `use-channel.ts` drops the **front** pages —
the ones that have been retained the longest, which sit nearest the live tail and
are already far *below* the reader's viewport while they scroll up — releases
their live `watchChannelMessages` subscriptions, and leaves the window at exactly
the cap.

- The **live tail** and the newest loaded history page are always retained.
- `hasOlder` still reads the deepest page's `nextCursor`, so scrolling up keeps
  loading older history no matter how far the window has slid.
- Live edits to a retained page replace it **in place** (instead of the old
  filter-then-append, which reordered the page to the end) so the chronological
  order the cap depends on is preserved.

### Re-fetching evicted pages (the reason for the seam)

The window slides toward older history as the reader scrolls up, so the pages it
drops are the *newer* ones between the retained window and the live tail. Two
things keep those recoverable and non-silent:

- **`historySeamId`** — while the window is truncated, the hook reports the id of
  the oldest live-tail message. `MessageList` draws a small boundary row
  ("Some messages were unloaded to keep this view fast") before it, so the
  dropped region is an explicit seam, never a silent jump in time.
- **`resetHistoryWindow()`** — when the reader settles back at the newest message
  (`atBottom`), `MessageList` re-anchors the window to the live tail, dropping the
  retained pages. The next scroll up then re-fetches from the tail cursor, so the
  evicted pages come back newest-older page first. This keeps mount work flat even
  after a user has paged all the way back to the top of the channel and returned.

### Choice / trade-off (documented, per the task)

Evicting the **oldest pages by load order** (nearest the tail) is the only rule
that both bounds the window and keeps upward pagination working: a bounded window
that stays contiguous with the tail cannot also advance deeper, because the
newly-fetched page is the oldest one. The alternative — evicting the deepest
(retained-longest-history) page — would remove content at the reader's leading
edge and create a jump. So the window slides with the reader and the seam falls
behind them, below the viewport; it is made explicit by the boundary row and is
healed automatically when they return to the newest message.

## What is preserved

- Cursor pagination and `hasOlder` (kept working past any number of evictions).
- Stick-to-bottom and the "Jump to latest" button.
- Scroll anchoring on prepend (`olderAnchorRef`) — the seam/reset only touch
  content below the viewport while scrolling up, and the layout effect still
  compensates height changes.
- `data-unread-divider` and the unread summary (the tail and near-tail pages,
  where the divider lives, are retained).
- Jump-to-message / search reveal: `ChatView` now re-anchors a truncated window
  and retries the walk instead of silently giving up when the target was evicted.
- Re-loading older history after eviction (re-fetched from the tail cursor).

## Tests

- `src/test/use-channel-window.test.tsx` (new): drives a 3,000-message channel
  one page at a time and asserts the mounted window never exceeds
  `(MAX_RETAINED_PAGES + 1) * MESSAGE_PAGE_SIZE`, that the window slides to the
  oldest message, that `historySeamId` marks the seam, and that
  `resetHistoryWindow()` re-anchors and re-fetches the evicted newest-older page.
- `src/test/message-list-scroll.test.tsx`: asserts the seam row renders and the
  window re-anchors when the reader is at the tail.
- Existing `message-list-*.test.tsx` and `use-channel-unread.test.tsx` are
  unchanged and still pass.

## Verification

Run from the repo root after the change:

- `bun run --cwd apps/web typecheck` → clean
- `bun run --cwd apps/web lint` → `Checked 358 files … No fixes applied`
- `bun run --cwd apps/web test` → `70 passed (70)`, `532 passed (532)`
