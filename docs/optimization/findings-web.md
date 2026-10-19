# Web client findings

Read-only audit of `apps/web` (Vite 8.3 + React 19.2 + TanStack Router 1.170 +
Tailwind 3.4 + Convex 1.46 + livekit-client) plus the workspace packages it
imports: `packages/ui-web`, `packages/core`, `packages/avatars`, `packages/tokens`.
Client cost is **per user**, so impacts below are per-tab unless stated.

Method: read the source, then ran a production build (`bunx vite build`, Vite 8
rolldown) and inspected the emitted chunks and a source-mapped rebuild to
attribute bytes. No code was modified.

## Summary (5 bullets max)

- **Every channel opens a live message subscription at once.** `ChatProvider`
  calls `session.openChannel()` for the whole channel list (up to 100 channels +
  100 DMs), each one a live `messages.list` query of 100 messages with plaintext
  bodies — up to ~200 subscriptions and ~20,000 decrypted messages per tab.
- **The app-wide context re-renders the whole chat tree on fixed timers.** An
  outbox ticker (5 s) and the owner update ticker (5 s) mint fresh context values,
  and during a call the mic meter pushes a new snapshot ~30×/s — every consumer
  (`ChatViewContent`) re-renders, including the sidebar and the full timeline.
- **Nothing is virtualized and no row is memoized.** Message timeline, member
  panel, kanban columns and admin tables render every row; the timeline grows
  without bound as history is paged in, and one inline array defeats the per-row
  Markdown parse memo so every row re-parses on every parent render.
- **The whole app ships as one 1.19 MB entry chunk (344 kB gzip).** No route or
  feature splitting: admin, kanban, notes, voice UI and better-auth are all in the
  initial chunk even for a user who only reads one channel; there is no
  `manualChunks`/`codeSplitting` config.
- **A handful of live queries are subscribed unconditionally and are expensive to
  recompute.** `messages.threadInbox` (global 1000-message scan + decrypt) and
  `notifications.unreadSummary` (reads every message of every joined channel) run
  for every client on every message in the workspace (see `findings-backend.md`
  B1; the client keeps them subscribed).

## Findings

### W1. Every channel's live message stream is opened at once (up to ~200 subscriptions, ~20k messages per tab)

- Evidence: `apps/web/src/providers/ChatProvider.tsx:303-338` (effect maps over
  **all** `channels` and awaits `active.session.openChannel(channel)` for each);
  `packages/core/src/chat/session.ts:186-198` (`openChannel` subscribes
  `subscriptions.watchMessages(channel.id)`); `apps/web/src/lib/convex-chat.ts:378-384`
  (`watchMessages` → `api.messages.list` with `PAGE = { numItems: 100 }`);
  `apps/web/src/components/chat/ChatSessionShell.tsx:31,60-61` (channels and DMs
  paged 100 at a time); `packages/convex/convex/messages.ts:270-283` + `toMessage`
  (`messages.ts:60-83`) returns the full plaintext body per message.
- Problem: on sign-in the client opens a live Convex subscription for the newest
  100 root messages of **every** conversation the user can see, not just the open
  one. Each subscription streams a `page` of 100 fully-decrypted message views,
  and the `ChatSession` caches every body/attachment descriptor in memory. The
  same messages are additionally re-fetched by `useChannelSession` for the active
  channel, so the open channel is subscribed twice.
- Impact at 100k: **high (client bandwidth + RAM + connect CPU)**. A user in 200
  conversations holds up to 200 open websocket queries and receives up to ~20,000
  message rows (with bodies) on load — easily multiple MB of JSON per tab, plus a
  `Map` entry per message body, per attachment and per name in `ChatSession`. It
  also multiplies the server's decrypt work per client by the number of channels
  (each `messages.list` decrypts 100 bodies). On a slow device the initial
  connect does 200 concurrent query materializations.
- Effort: medium.
- Risk: medium — search backfill and notification/sound logic read from
  `session.onDecrypted`, so an "open only what is visible" change must keep the
  index/backfill path (which already pages history on demand) as the source for
  unopened channels.
- Proposed fix: open only the active channel plus a small recent set (e.g. the
  conversations the sidebar highlights as unread), and open the rest lazily on
  select. Drive the unread badge from `readStates.summary` (already subscribed)
  and the local search index instead of per-channel message streams. At minimum
  lower `PAGE.numItems` for background channels and drop `openChannel` from the
  ChatProvider fan-out.

### W2. Mic-level meter re-renders the entire app ~30×/s during a call

- Evidence: `apps/web/src/lib/voice/media.ts:157,192` (`METER_INTERVAL_MS = 33`,
  `setInterval(tick, …)` emits every value); `apps/web/src/lib/voice/call-engine.ts:377-382`
  (level callback sets `micLevel`/`localSpeaking` then calls `this.emit()`
  **unconditionally**, i.e. ~30 Hz while the meter runs);
  `apps/web/src/providers/VoiceProvider.tsx:165-167` (`subscribe` → `setSnapshot`),
  `:461-526` (context value spreads `...snapshot`, which includes `micLevel`);
  `apps/web/src/components/chat/ChatView.tsx:191-193` (`ChatViewContent` calls
  `useVoice()` and therefore re-renders on every snapshot).
- Problem: `snapshot.micLevel` changes every 33 ms while the microphone is open,
  and it is part of the `VoiceContext` value. Every `useVoice()` consumer —
  including the whole `ChatViewContent` subtree (sidebar, member panel, message
  timeline, open kanban/notes) — re-renders ~30 times a second for the duration of
  the call. Unlike remote speaking (which is transition-only, see
  `peer-mesh.ts:435-447`), the local meter emits on every tick.
- Impact at 100k: **high (per-user CPU/battery)**. During any call the main thread
  spends its idle budget re-rendering the chat surface 30×/s; on a mid-range
  laptop this shows up as fan spin and dropped frames while scrolling the
  timeline. Calls also tend to coincide with people typing and reading, so the
  wasted renders compete with real work.
- Effort: low-medium.
- Risk: low — the level only feeds the mic indicator; it does not need to live in
  the shared context.
- Proposed fix: throttle/quantize `emit()` for level-only changes (only emit when
  the rounded level or the `localSpeaking` boolean actually changes, and no more
  than ~10 Hz), or move `micLevel` out of the shared context into a dedicated hook /
  external store consumed only by the level meter components. Wrap
  `ChatViewContent` in `React.memo` and split high-churn voice fields out of the
  context value so unrelated fields do not invalidate it.

### W3. ChatProvider mints a new context value every 5 s (empty outbox included)

- Evidence: `apps/web/src/providers/ChatProvider.tsx:274-285` (retry ticker
  `setInterval(…, 5_000)` calls `flush()` unconditionally),
  `:209-215` + `:243` (`flush` always ends with `await refreshOutbox()`),
  `:209-215` (`setOutbox(await active.list())`); `packages/core/src/outbox/index.ts:201-204`
  (`list()` returns a freshly sorted copy, so the reference always changes);
  `:479-512` (the whole `outbox` array and every other field is spread into a
  single `value` object, recreated whenever any field changes);
  `apps/web/src/components/chat/ChatView.tsx:191-192` (consumers destructure the
  full context).
- Problem: even with nothing queued, the outbox flush ticker runs every 5 seconds
  and always replaces the `outbox` array with a new reference, so the context
  value is a new object and **every** `useChat()` consumer re-renders every 5 s.
  There is no split between "stable actions" and "changing data" in the context.
- Impact at 100k: **medium (per-user CPU)**. A 5-second full re-render of the chat
  tree is not catastrophic on its own, but it stacks with the presence updates
  (W8), the voice snapshot (W2) and the owner ticker (W7), turning an idle tab
  into a steady drip of render work. On large timelines (W4) each of these
  re-renders walks every mounted message row.
- Effort: low.
- Risk: low.
- Proposed fix: bail out of `setOutbox` when the pending list is unchanged (e.g.
  skip the flush+refresh when `outboxRef.current` is empty and stay idle until an
  item is enqueued or `online` changes), and split the context: a stable actions
  context plus a small data context, or `useSyncExternalStore` selectors so a
  component only re-renders for the slice it reads.

### W4. Message timeline is unvirtualized and grows without bound

- Evidence: `apps/web/src/components/chat/MessageList.tsx:297-305` (`items.map(…)`
  renders one `TimelineRow` per timeline item, no windowing);
  `apps/web/src/lib/use-channel.ts:232-260` (`loadOlder` appends each older page
  of 100, and pages are never evicted: `messages` at `:262-269` concatenates
  **all** older pages plus the tail); `apps/web/src/components/chat/MessageList.tsx:330-372`
  (`TimelineRow`/`MessageRow` are plain functions, never `React.memo`-wrapped; the
  global `grep` for `memo(` in `src` returns nothing).
- Problem: scrolling up keeps every loaded page in the DOM for the life of the
  channel view, and any state change in `MessageList` (a reactions update, the
  `atBottom` flip, a typing tick) re-renders every mounted row because rows are not
  memoized. Loading old history is therefore permanently additive: a user who
  scrolls back through a long channel ends up with thousands of `<article>` rows.
- Impact at 100k: **high (per-user RAM + CPU)**. Long-lived channels are the norm
  in a mature workspace; a few thousand mounted rows means MBs of DOM and a
  multi-hundred-millisecond re-render every time anything in the list changes
  (typing indicator, reaction, new message). This is the most common source of
  "the app gets slower the longer I leave it open".
- Effort: medium-high.
- Risk: medium — the list does careful scroll anchoring (`olderAnchorRef`,
  `data-unread-divider`, stick-to-bottom), so a virtualizer must preserve those
  behaviours; the existing tests in `src/test/message-list-*.test.tsx` cover them.
- Proposed fix: adopt a virtualizer (`@tanstack/react-virtual` fits the existing
  stack) over the flattened timeline items, keeping a bounded window (e.g. the
  tail plus a few pages). Independently, wrap `MessageRow`/`TimelineRow` in
  `React.memo` with a stable `list` prop and memoized callbacks — that alone
  removes most of the wasted row renders.

### W5. An inline array defeats the per-row Markdown parse memo, and rows are not memoized

- Evidence: `apps/web/src/components/chat/ChannelPane.tsx:179`
  (`channelNames={props.channelMentions.map((entry) => entry.name)}` — a brand-new
  array on every render); `apps/web/src/components/chat/RichText.tsx:30-37`
  (`useMemo(… parseRichText(text, { mentionNames, channelNames }), [text, mentionNames, channelNames])`);
  `apps/web/src/components/chat/MessageList.tsx:297-304` and `:330-372` (rows are
  unmemoized and receive the whole `props` object).
- Problem: `RichText` is memoized on the identity of `channelNames`, but the
  parent constructs that array inline, so the memo never holds for more than one
  render. Every `MessageRow` re-runs `parseRichText` for its body (and for its
  reply quote) on **every** render of the list. Combined with W2/W3/W8 (which
  re-render the list frequently) this is a continuous parse cost proportional to
  the number of mounted messages, and it also re-creates the inline `<span>`/`<p>`
  children each pass.
- Impact at 100k: **medium (per-user CPU)**. Parsing a message is cheap, but a
  thousand mounted rows × several re-renders per second adds up to visible jank
  while scrolling, and it is pure waste — the text did not change.
- Effort: low.
- Risk: low — the memo already exists; only the dependency identity is wrong.
- Proposed fix: hoist the channel-name array into a `useMemo` keyed on
  `channelMentions` (and do the same for any other inline array/object passed to
  `RichText`), then wrap `MessageRow` in `React.memo` with a stable `list` prop.

### W6. No route or feature code splitting — one 1.19 MB entry chunk for every user

- Evidence: `apps/web/src/router.tsx:22-28` (root/`HomeRoute`/`ConnectRoute`/
  `RedeemRoute` are static imports; only the `import.meta.env.DEV` previews are
  `lazy`); `apps/web/src/routes/HomeRoute.tsx:3` (`ProfileSession` imported
  statically); `apps/web/src/components/chat/ChatView.tsx:45-55` (static imports of
  `AdminPanel`, `KanbanView`, `NotesView`, `CallStage`, `CallDock`,
  `VoiceChannelView`); `apps/web/vite.config.ts:29-43` (no `build.rollupOptions`
  /`codeSplitting`/`manualChunks` at all).
- Problem: nothing is split, so a visitor on the connect screen and a user reading
  one channel both download the entire admin panel, kanban board, notes editor,
  call UI, and the better-auth React client before the app can render.
- Impact at 100k: **medium (per-user bandwidth + startup)**. Production build
  emits a single `index-*.js` of **1,188,873 B (343.9 kB gzip)** and a
  `index-*.css` of 80,992 B (14.5 kB gzip). The source map attributes roughly
  532 kB (raw) to `react-dom`, 181 kB to `convex`, 225 kB to `@tanstack`,
  37 kB to `better-auth` client + 24 kB `@better-fetch` + 10 kB `nanostores`, and
  345 kB/161 kB/106 kB to admin/kanban/notes source that most sessions never open.
  A cold start pays for all of it before first paint.
- Effort: medium.
- Risk: low-medium — route-level `lazy` + `Suspense` for the admin/kanban/notes
  surfaces has no behavioural risk; splitting the pre-session screens from the
  signed-in shell is the larger win and needs a loading boundary.
- Proposed fix: lazy-load `AdminPanel`, `KanbanView`, `NotesView` and the
  call/voice surfaces behind `React.lazy` + `Suspense` (they already render
  conditionally, so a `<Suspense>` boundary per surface is enough), lazy-load
  `ProfileSession` (and its better-auth/Convex provider wiring) from `HomeRoute`,
  and add a `manualChunks`/`codeSplitting` rule that separates `react`/`react-dom`,
  `convex`, `@tanstack/*` and `better-auth` into vendor chunks for better caching.

### W7. WorkspaceUpdateProvider wraps the whole chat view, ticks every 5 s, and is not memoized

- Evidence: `apps/web/src/providers/WorkspaceUpdateProvider.tsx:43-52`
  (`setInterval(() => setNow(Date.now()), 5000)` while the viewer is the owner),
  `:195-197` (`<Context.Provider value={{ available, settings }}>` — a new object
  **and** a new `settings` React element every render);
  `apps/web/src/components/chat/ChatView.tsx:169-174` (the provider wraps
  `ChatViewContent`, which then calls `useWorkspaceUpdates()` at `:195`).
- Problem: for an owner, `now` changes every 5 s, which re-renders the provider and
  produces a fresh context value; `ChatViewContent` is a consumer, so the entire
  chat surface (sidebar + timeline + panels) re-renders at 2× the outbox ticker
  rate. The inline `value` object would cause the same re-render on *any* provider
  render, not just the tick.
- Impact at 100k: **low-medium (per-user CPU, owners only)**. Owners are the ones
  who also tend to sit in busy channels; the tick is pure overhead when no update
  is in progress.
- Effort: low.
- Risk: low.
- Proposed fix: stop the 5 s tick unless an update is actually in flight (a
  countdown only matters while `phase` is non-idle), memoize the context value
  with `useMemo`, and prefer holding the `settings` element out of the context —
  expose the data and let the one consumer that needs it render `<UpdateSettings>`.

### W8. `presence.list` is subscribed live and its O(all members) payload is resent on every heartbeat

- Evidence: `apps/web/src/providers/ChatProvider.tsx:202-207`
  (`runtime.subscriptions.watchPresence(setPresence)`);
  `apps/web/src/lib/convex-chat.ts:417-419` (`watchPresence` → `api.presence.list`);
  `packages/convex/convex/presence.ts` `list` (`presence.collect()` + one
  `openContentOptional` decrypt per row); consumed at
  `apps/web/src/components/chat/ChatView.tsx:420-431` (`presenceByUser`,
  `onlineCount`) and `:517-527` (a `useEffect` over **every** presence row calling
  `setCustomStatuses` with a new `Map` per row with a custom status).
- Problem: the whole presence table (one row per member, with decrypted custom
  status) is streamed to every client and re-sent whenever any row changes. With
  heartbeats every 30 s (`use-presence-heartbeat.ts:17`), the query re-runs
  continuously as members move between online/idle/offline. On the client the
  `presence` array then invalidates the ChatProvider context (all consumers
  re-render) and the per-row status effect rebuilds the map N times per update.
- Impact at 100k: **high (client bandwidth + CPU, and it amplifies W3/W4)**. Each
  heartbeat from any member pushes a full member-sized array to every client, so a
  busy workspace re-renders every connected tab several times a second and re-sends
  the whole roster each time. `findings-backend.md` B3 covers the server cost; from
  the client side it is also the main driver of idle re-renders.
- Effort: medium.
- Risk: medium (shared contract with `core`/mobile).
- Proposed fix: subscribe only to the presence of the members actually on screen
  (a `presence.getMany({ userIds })` over the visible roster, driven by the member
  panel and the open channel), or page it. On the client, select just the status
  map from the subscription and reduce it to a stable value before it reaches the
  context, and replace the per-row `setCustomStatuses` loop with a single
  `setState` that builds the map once per update.

### W9. The search palette is fully controlled by ChatView, so every keystroke re-renders the whole chat surface

- Evidence: `apps/web/src/components/chat/ChatView.tsx:242` (`searchQuery`
  lives in `ChatViewContent` state), `:1720-1729`
  (`<SearchPanel query={searchQuery} … onQueryChange={setSearchQuery} />`),
  `:579-627` (search effect runs on `searchQuery` with a 120 ms debounce, then
  loops `chat.loadSearchHistory()` + `chat.search()` until complete);
  `apps/web/src/components/chat/SearchPanel.tsx:36-70` (the panel derives its
  filtered list from the controlled `query`).
- Problem: the palette is rendered inside the same component as the timeline, so
  each character typed/replaced in the search box sets state on `ChatViewContent`
  and re-renders the sidebar, the entire mounted message timeline and any open
  panel — before the 120 ms debounce even fires. React 19's `useDeferredValue`
  exists for exactly this shape of input. Separately, the search effect loops
  server backfill while recomputing results each step, and the local index that it
  queries holds every indexed message body in memory and prefix-scans all tokens
  (`packages/core/src/search/index.ts:220-239` iterates the whole `postings` map per
  term; `:122-142` loads every persisted document into a `Map`).
- Impact at 100k: **medium (per-user CPU/latency)**. Typing in the palette is the
  single most latency-sensitive interaction; re-rendering a thousands-of-rows
  timeline on each keystroke makes it feel laggy. The in-memory index also grows
  with the archive the user has searched (bounded by history but unbounded across
  a long-lived tab).
- Effort: low for the input; medium for the index.
- Risk: low.
- Proposed fix: move the query text into `SearchPanel` as uncontrolled local state
  (notify the parent only when the debounced query changes, or use
  `useDeferredValue`/`useTransition` for the derived results) so keystrokes never
  touch the chat tree; memoize the panel and pass stable callbacks. For the index,
  cap the postings prefix scan (or precompute prefix→posting buckets) and consider
  an LRU cap on resident documents rather than loading the entire archive.

### W10. `messages.threadInbox` is subscribed permanently and rescans the global message table

- Evidence: `apps/web/src/components/chat/ChatView.tsx:279`
  (`const threadRows = useQuery(api.messages.threadInbox, {});` — always, so its
  mention badge can render), `:285-288` (filters it on every render);
  `packages/convex/convex/messages.ts:502-508` →
  `packages/convex/convex/lib/threadInbox.ts:164-200`
  (`messages.order("desc").take(THREAD_INBOX_SCAN_LIMIT)` with
  `THREAD_INBOX_SCAN_LIMIT = 1000` at `:30`, then loads roots, checks channel
  visibility and `openContent`-decrypts each returned body).
- Problem: the client keeps this query live for the user's whole session purely to
  show a badge, and the query scans the 1000 most recent messages in the entire
  deployment and decrypts up to 50 thread roots. It re-runs on every new message
  anywhere in the workspace.
- Impact at 100k: **high (server cost triggered per client, small client payload)**.
  The response is small, but every message written by anyone re-runs a
  deployment-wide scan + decrypt for every connected client. `findings-backend.md`
  does not list this one; from the client side it is a permanent, avoidable
  subscription.
- Effort: medium.
- Risk: medium — the badge must still update without the threads panel open.
- Proposed fix: only subscribe while the Threads view is open, and replace the
  always-on badge with a cheap server-side counter (e.g. a per-user
  `threadMentionCount` maintained on reply/mention, exposed on the presence/read-state
  summary the client already subscribes to).

### W11. `notifications.unreadSummary` is subscribed app-wide by every client

- Evidence: `apps/web/src/lib/use-desktop-unread.ts:20`
  (`useQuery(api.notifications.unreadSummary, {})`), called from
  `apps/web/src/components/chat/ChatView.tsx:297` via `useLiveUnreadBadge()`
  (desktop badge + `navigator.setAppBadge`); server shape in
  `packages/convex/convex/notifications.ts` `unreadSummary` (collects all messages
  of every joined channel; see `findings-backend.md` B1).
- Problem: the client holds this subscription for the whole session to drive an OS
  badge, and the query is O(all messages in all joined channels) per run, re-run on
  every message in any channel the viewer belongs to.
- Impact at 100k: **high (bandwidth-adjacent: it is the trigger for the worst
  server query the client issues)**. Per-user payload is tiny (`{total, mentions}`),
  but it is the client behaviour that makes B1 continuous. Also, because it is a
  hook inside `ChatViewContent`, each new summary value re-renders the chat tree.
- Effort: low (client) / covered by B1 (server).
- Risk: low.
- Proposed fix: until B1 is fixed, throttle the badge (e.g. recompute on a coarse
  interval or on focus) instead of streaming; longer term consume the bounded
  counter that B1 recommends. Keep the value out of the chat context so a badge
  change does not re-render the timeline.

### W12. Attachment object URLs leak on unmount (thumbnail fallback and open lightbox)

- Evidence: `apps/web/src/components/chat/AttachmentView.tsx:121-139`
  (`loadAttachmentUrl` → object URL; `openFull` sets `fullUrl`; `closeFull`
  revokes, but there is no unmount cleanup for `fullUrl`);
  `:144-163` (fallback when there is no dedicated thumbnail: `loadAttachmentUrl`
  resolves an object URL into `thumbnailUrl`, and the effect cleanup only sets
  `cancelled = true` — it never calls `URL.revokeObjectURL`);
  `apps/web/src/lib/attachments.ts:121-139` (both loaders return
  `URL.createObjectURL`).
- Problem: two paths create blob URLs the component never releases. If the user
  closes the lightbox by navigating away (which the timeline does constantly when
  a message scrolls out or the channel/virtualization window changes), the full
  image blob stays alive for the tab's lifetime; the same is true of the fallback
  thumbnail blob. The well-behaved paths (`:73-97`, `:204-211`) show the intended
  pattern.
- Impact at 100k: **medium (per-user RAM, grows with session length)**. Full-size
  images are the largest objects a chat client holds; leaking one per
  thumbnail-less image viewed in a long session adds up to tens/hundreds of MB in
  a heavy channel, and it survives channel switches.
- Effort: low.
- Risk: low.
- Proposed fix: track the created URL in a ref and revoke it in a mount-scoped
  cleanup, mirroring the pattern already used for the primary thumbnail; add an
  unmount effect that revokes `fullUrl` if set. Consider centralizing object-URL
  creation in a small hook that guarantees revocation.

### W13. Kanban collects and decrypts every card, renders them unvirtualized, and re-renders every second

- Evidence: `packages/convex/convex/kanban.ts` `listCards`
  (`kanbanCards … collect()` then per-card `cardContent(…)` decrypt — no
  pagination), subscribed at `apps/web/src/components/kanban/use-board.ts:102-103`
  (`useQuery(api.kanban.listCards, board ? { boardId } : "skip")`);
  `apps/web/src/components/kanban/use-board.ts:129-137`
  (`useClock` ticks `setNow(Date.now())` every 1000 ms);
  `apps/web/src/components/kanban/BoardColumns.tsx:212` (`board.columns.map(…)`
  renders every column and `cardsInColumn(ctl.filtered, column.id)` every card).
- Problem: the board is one live query returning every card (with decrypted
  content) and the whole board re-renders once a second for due-date countdowns,
  walking every card in every column. Any card edit re-runs the full collect +
  decrypt on the server and pushes the whole board to every viewer.
- Impact at 100k: **medium (per-user CPU while the board is open)**, plus a server
  amplification (a workspace with a few hundred cards pushes the full board on
  every change). The 1 s tick alone is ~3600 needless board renders per hour of an
  open board.
- Effort: medium.
- Risk: low-medium.
- Proposed fix: pause the clock when the board is not visible (or drive it from
  the countdown components only), memoize card tiles (`CardTile`) and the column
  list, and virtualize columns for large boards. Server-side, paginate
  `listCards` (or at least stop decrypting card bodies for the board view until a
  card is opened).

### W14. Member panel renders every member with an O(members × visible) filter

- Evidence: `apps/web/src/components/chat/MembersPanel.tsx:53-79` (sorts all
  members, then `groupMembersByHoistedRole`, then maps every member into a `li` —
  no windowing); `packages/core/src/members-grouping.ts` (linear in members × their
  roles); `apps/web/src/components/chat/ChatView.tsx:654-662`
  (`visibleMembers` filters `members` with `(visibleMemberIds as readonly string[]).includes(member.userId)`
  inside the predicate — O(members × visibleIds)).
- Problem: opening the member list mounts one row per member (plus avatar SVGs) with
  no virtualization, and the visibility filter is quadratic. The member list itself
  is a single global collect (see `findings-backend.md` B2), so a large workspace
  sends the full roster and then renders it.
- Impact at 100k: **medium (per-user CPU/RAM when the panel is open)**. For a
  workspace of a few thousand members the panel is a multi-thousand-node DOM with a
  per-render O(n²) filter; combined with presence updates (W8) it re-renders often.
- Effort: low-medium.
- Risk: low.
- Proposed fix: build a `Set` from `visibleMemberIds` once (or use a
  `Set`-membership predicate) instead of `Array.includes`, and virtualize the
  grouped member list. Memoize `MemberGroup`/row components.

### W15. VoiceProvider polls the auth token every 60 s for every signed-in user, even with no call

- Evidence: `apps/web/src/providers/VoiceProvider.tsx:254-276`
  (on mount, `fetch("/api/auth/convex/token", { credentials: "include" })` then
  `setInterval(refresh, TOKEN_REFRESH_MS)` with `TOKEN_REFRESH_MS = 60_000` at
  `:37`), mounted for every signed-in session via
  `apps/web/src/components/chat/ChatSessionShell.tsx:184-189`.
- Problem: the cached token exists only so the unload beacon can authenticate on
  the way out of a call, but the refresh runs unconditionally — a user who never
  joins a voice channel still hits the auth endpoint once a minute forever.
- Impact at 100k: **low-medium (per-user request volume / battery)**. It is one
  cheap first-party request per user per minute, but it is also a timer that wakes
  every tab constantly (and can keep a background tab from idling), and it scales
  into a steady request stream against the auth upstream.
- Effort: low.
- Risk: low.
- Proposed fix: only start the refresh interval while a call is active (or while
  `snapshot.callId !== null`), and fetch the token lazily on call start; a token is
  only needed for the unload beacon while a seat is held.

### W16. The better-auth React client is in the entry chunk although it is only needed after sign-in

- Evidence: `apps/web/src/components/ProfileSession.tsx:2-3`
  (`import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"`),
  `apps/web/src/lib/auth-client.ts:1-3` (`createAuthClient` from `better-auth/react`
  plus plugins), reached eagerly from `apps/web/src/routes/HomeRoute.tsx:3`
  (`ProfileSession`). Build confirms it: the source-mapped entry chunk contains
  ~37 kB of `better-auth` client source, ~24 kB `@better-fetch/fetch`, ~10 kB
  `nanostores` and ~8 kB `@convex-dev/better-auth`, and the minified chunk contains
  `better-auth` strings.
- Problem: auth-client code and its fetch/state layers download on the connect
  screen and for every signed-in user, in the critical path, even though the
  pre-session screens only need the profile store.
- Impact at 100k: **low-medium (per-user startup bandwidth/parse)**. Roughly
  ~50-80 kB raw (~15-20 kB gzip) in the critical chunk that could load after paint.
- Effort: medium.
- Risk: low-medium.
- Proposed fix: lazy-load `ProfileSession` (and therefore the
  better-auth/Convex-provider wiring) from `HomeRoute` behind `Suspense`, so the
  connect/join screens paint from a much smaller entry chunk and auth code streams
  in when a server profile is actually opened.

### W17. Production serving ships no Brotli/precompressed assets and no vendor chunking

- Evidence: `apps/web/vite.config.ts:29-43` (build config has no
  `rollupOptions`/`codeSplitting`, no compression plugin);
  `infra/docker/nginx/default.conf.template` (`gzip on; gzip_types …` with no
  `gzip_static`/Brotli; `location ^~ /assets/ { expires 1y; }` has no `immutable`);
  `infra/docker/proxy/Caddyfile.example` (`encode zstd gzip` only on the edge,
  which is a reference not part of the compose stack).
- Problem: the 1.19 MB entry chunk and the 13 MB MediaPipe wasm are compressed on
  the fly with gzip at the origin; there is no precompressed (`.br`/`.gz`) output
  and no Brotli, so every client pays gzip's ~25-30% worse ratio than Brotli on the
  largest assets. The single vendor-inclusive entry chunk also means any
  dependency bump invalidates the whole file for all users.
- Impact at 100k: **low-medium (per-user bytes on first load and after deploys)**.
  Brotli would cut the biggest script and wasm payloads by ~15-25%, and
  precompression removes per-request origin CPU. The missing `immutable` on hashed
  `/assets/` is a minor revalidation cost.
- Effort: low.
- Risk: low.
- Proposed fix: emit precompressed assets (e.g. `vite-plugin-compression2` for
  both gzip and Brotli) and enable `brotli_static`/`gzip_static` + `try_files …
  .br` in the nginx template (or move to a proxy that does Brotli); add
  `immutable` to the `/assets/` `expires` block; combine with the vendor chunking
  in W6 so dependency changes do not invalidate the app chunk.

## Bundle observations

Production build (`bunx vite build`, Vite 8.3.1 / rolldown, 794 modules, minified,
no sourcemap). Sizes in bytes as emitted:

| Asset | Raw | Gzip |
| --- | ---: | ---: |
| `index-*.js` (entry: react-dom, router, convex, better-auth, **all** app UI) | 1,188,873 | 343,910 |
| `index-*.css` | 80,992 | 14,500 |
| `livekit-client.esm-*.js` (lazy, separate chunk) | 555,836 | 144,730 |
| `vision_bundle-*.js` (MediaPipe, lazy) | 154,291 | 45,570 |
| `vision_wasm_internal-*.wasm` (lazy) | 12,997,248 | 3,896,980 |
| `selfie_segmenter_landscape-*.tflite` (model, lazy) | 250,177 | — |
| `rnnoise-*.wasm` / `rnnoise_simd-*.wasm` (lazy) | 152,656 / 157,234 | 114,040 / 115,850 |
| `workletProcessor-*.js` (audio worklet) | 64,483 | — |
| `vision_wasm_internal-*.js` (MediaPipe loader) | 335,393 | — |
| `dist` total | ~15 MB | — |

Source-map attribution of the **entry** chunk (raw source bytes, per feature):

- `react-dom` 533 kB, `@tanstack/*` 225 kB, `convex` 181 kB, `better-auth` +
  `@better-fetch` + `nanostores` + `@convex-dev/better-auth` ~85 kB,
  `blobatar`/`@blobatar` 32 kB, `scheduler` 10 kB.
- App code ~1,510 kB raw, split: `chat` 378 kB, `admin` 345 kB, `voice` 199 kB,
  `kanban` 161 kB, `lib` 141 kB, other components 111 kB, `notes` 107 kB,
  `providers` 60 kB. `packages/core` 193 kB, `packages/ui-web` 61 kB,
  `packages/tokens` (icon path map, all 95 icons) 44 kB, `packages/avatars` 12 kB.

Notes:

- **No `manualChunks`/`codeSplitting`** (`vite.config.ts`) and no route `lazy`, so
  the figures above are what every visitor downloads before first paint (W6).
- Heavy optional libraries are already dynamically imported and land in their own
  chunks: `livekit-client` (`src/lib/voice/sfu-room.ts:167`), `@mediapipe/tasks-vision`
  (`src/lib/voice/effects/segmenter.ts:52`) and `@sapphi-red/web-noise-suppressor`
  (`src/lib/voice/mic-pipeline.ts:55`). Their *URL strings* still ship in the entry
  chunk but not their code.
- No unused production dependencies found: every entry in
  `apps/web/package.json` (`@aulora/*`, `@convex-dev/better-auth`,
  `@mediapipe/tasks-vision`, `@sapphi-red/web-noise-suppressor`,
  `@tanstack/react-router`, `better-auth`, `convex`, `livekit-client`, `react`,
  `react-dom`) is referenced. No duplicate heavy libraries across workspace
  packages (`convex`, `react`, `@tanstack/*` appear once; the only shared vendored
  lib is `blobatar` via `packages/avatars`).
- No web fonts: `src/styles/globals.css` declares no `@font-face` and no external
  font requests, so there is no font-payload or FOIT cost. The only image is
  `public/favicon.svg` (2,173 B).
- The MediaPipe wasm is 12.99 MB raw (3.9 MB gzip) but is fetched only when a
  background effect or blur is actually enabled, and the CSP/`assetsInlineLimit`
  guard keeps it a real same-origin file (`vite.config.ts:4-6,38-42`).

## Already-good notes

- **Optional heavy modules are correctly lazy.** livekit, MediaPipe and the RNNoise
  suppressor are all `await import()`ed and ship as separate chunks; the
  `keepLoadableAssetsAsFiles` guard in `vite.config.ts` keeps worklets, wasm,
  models and workers out of `data:` URLs so `script-src 'self'` holds.
- **Audio and video processing run off the render loop.** The mic chain is an
  `AudioWorklet` (`src/lib/voice/mic-pipeline.ts:10-28`), and the background effect
  pulls frames from insertable streams and composites on WebGL with an adaptive
  every-other-frame fallback (`src/lib/voice/effects/background-effect.ts:34-38,151-159`).
  The mic level meter is an AnalyserNode (its frequency is a problem — W2 — but it
  is not doing DSP on the main thread).
- **Reactions are batched.** `watchReactionsBatch` chunks message ids by 100
  (`src/lib/convex-chat.ts:388-416`) instead of one live query per message, and
  `MessageList` keeps a single subscription for the whole timeline
  (`MessageList.tsx:138-162`). Speaking indicators use hysteresis so remote peers
  only emit on state transitions (`peer-sync`/`peer-mesh.ts:432-447`).
- **History uses Convex cursors, not a growing window.** `use-channel.ts:139-147,
  232-260` walks older pages with `continueCursor` so scrolling up N pages costs N
  small reads instead of re-reading and re-delivering the entire window.
- **Attachments are lazy and revoked on the happy path.** `AttachmentView` defers
  downloads with an `IntersectionObserver` (`:44-71`), sets `loading="lazy"`/
  `decoding="async"` on images (`:244-245,272`), shows a blurhash placeholder
  (`:222-236`), and revokes the thumbnail/media URLs in the primary effects
  (`:73-97,204-211`). The gaps are the fallback and lightbox paths (W12).
- **Notification audio is synthesized**, not downloaded (`src/lib/sounds.ts:10-14`),
  so there are no binary sound assets, and the shared `AudioContext` is resumed on
  the first gesture so an incoming-call cue is not dropped.
- **Caching and security headers are sensible.** nginx serves hashed `/assets/`
  with a one-year `expires` and never-caches `index.html`/`push-sw.js`/
  `theme-boot.js`, sets `nosniff`/`Referrer-Policy`/`X-Frame-Options`/
  `Permissions-Policy`, and the edge example adds HSTS and a strict CSP. gzip is
  enabled for js/css/json/wasm/svg.
- **Event listeners and observers are cleaned up.** The presence heartbeat
  (`use-presence-heartbeat.ts:100-110`), the online/offline handlers
  (`ChatProvider.tsx:246-264`), the `ResizeObserver` (`MessageList.tsx:223-240`),
  the `IntersectionObserver`, the call token/interval, push-to-talk, keyboard
  shortcuts and the Pip ticker all remove/clear on teardown; `ChatSession.dispose()`
  closes every open channel subscription (`session.ts:500-505`).
- **Dev-only preview routes are compiled out of production**
  (`router.tsx:22-40,56-60`), so the preview harnesses do not ship.
- **`StrictMode` is enabled** (`main.tsx:16-20`), which surfaces double-invoked
  effect bugs early — worth keeping given the several subscription-heavy effects.





