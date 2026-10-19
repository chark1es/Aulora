# Mobile client findings

Read-only audit of `apps/mobile` (Expo SDK 57 / RN 0.86 / Expo Router / NativeWind 4.2 /
React 19.2 / Convex 1.46 / reanimated 4.5 / react-native-webrtc), plus the shared code it
imports from `packages/core`, `packages/ui-native`, `packages/avatars`.

## Summary (5 bullets max)

- The message timeline is the hot path and it is unvirtualized in practice: `MessageList`
  has no list tuning, no memoized rows, an unstable per-render row context, and an
  `O(rows × messages)` reply lookup that runs on every render.
- Work is duplicated per client and per workspace size: `members.list` and `presence.list`
  are unpaginated, the presence query is held twice (provider + `ChatSession.start`), and
  every presence heartbeat re-renders the whole provider consumer tree.
- Per-message live Convex subscriptions (`ReactionRow`) multiply with the FlatList window,
  so one open channel holds dozens-to-hundreds of live server queries.
- Images are downloaded at full size and base64-encoded through a per-byte JS loop just to
  draw a 320×180 thumbnail; there is no image cache, no thumbnails and no `expo-image`.
- Battery/network: typing fires a mutation per keystroke (web has a throttle), the outbox
  flushes every 5 s even when empty (invalidating the app-wide context), and an active call
  re-renders the chat subtree on every audio-level poll.

## Findings

### M1. Message list re-renders everything on every change, and reply previews are O(n²)

- Evidence: `apps/mobile/src/components/chat/MessageList.tsx:271-282` (row context object
  and handler closures built inline on each render), `:305-307` (inline `renderItem`),
  `:216-244` (`RowItem` is not memoized and receives the entire `props` object),
  `:161-172` (`replyPreview()` runs `props.messages.find(...)` for every reply row on every
  render), `:309` (`indexOfMessage(rows, firstUnreadId)` per render).
- Problem: `MessageList` receives a fresh `attachments` map (`use-chat-screen-data.ts:424`)
  and a fresh `decrypted`/`memberNames` identity on most updates. Because rows are not
  memoized and share one inline `context`, **every mounted row re-renders on any change** —
  a new message, a presence tick, a keystroke-driven parent render, a reply-preview change.
  Each row then re-parses its Markdown (`RichText.tsx:30`, no `useMemo`) and regenerates its
  avatar SVG (`packages/avatars/src/native.tsx:80`). On top of that, `replyPreview` scans the
  full message array per reply row, so a 1 000-message channel with 200 replies does
  ~200 000 comparisons per render pass.
- Impact at 100k: per-device — jank and dropped frames while scrolling or typing in busy
  channels; CPU/battery — sustained re-render load scales with `loaded messages × replies`
  on every incoming event; a channel with heavy reply usage effectively double-nails the JS
  thread during back-scroll.
- Effort: M (2–4 days).
- Risk: Medium — touches the core timeline component; needs scroll/jump regression checks.
- Proposed fix: build the reply index once per `rows` memo (id → message) instead of
  `find`; hoist `context`/`renderItem` into `useMemo`/`useCallback` (or split the context into
  stable per-field values); wrap `RowItem`/`MessageRow` in `React.memo` with primitive props
  plus a stable context; `useMemo` the `parseRichText` result inside `RichText`; memoize
  `avatarSvg` per `(seed,size)`.

### M2. One live Convex reaction subscription per mounted message row

- Evidence: `apps/mobile/src/components/chat/ReactionRow.tsx:59-68`
  (`runtime.subscriptions.watchReactions(messageId, …)` inside `useEffect`), rendered for
  every message with `runtime !== undefined` in `MessageRow.tsx:221-233`;
  `convex-chat.ts:439-441` (each call is a `client.watchQuery(api.reactions.list, {messageId})`);
  `MessageList.tsx:287-308` (no lazy/section-based mounting).
- Problem: every row in the FlatList window opens its own long-lived Convex query, even for
  messages that can never have reactions (and before any reaction exists). FlatList's default
  `windowSize` keeps many screens of rows mounted, so a single open channel holds dozens to
  hundreds of live server subscriptions per client, each re-running on update and calling
  `loadReactions` + `setGroups` (`ReactionRow.tsx:60-64`).
- Impact at 100k: network/server — each connected client multiplies server query load by the
  number of rendered rows; per-device — dozens of extra websocket query results, extra state
  updates and `groupReactions` allocations per session; battery — awake radio for a mostly
  empty result set.
- Effort: S–M (1–2 days for the pragmatic fix).
- Risk: Low–Medium (reaction updates must still arrive while a message is visible).
- Proposed fix: batch — subscribe once per channel to the reactions for the visible id set
  (or return `reactionSummary` on the message payload); mount the subscription only for rows
  that already have `reactionCount > 0`, and only while the row is visible
  (`onViewableItemsChanged`). Server already has the data; extend `api.messages.list` with a
  reaction summary so most rows never subscribe at all.

### M3. Workspace-wide unpaginated member/presence data, subscribed twice, invalidating the whole app

- Evidence: `apps/mobile/src/providers/ChatProvider.tsx:358-361`
  (`useQuery(api.members.list, {})`, `api.roles.list`, `api.members.me`, `api.categories.list`)
  and `:210-218` (`watchChannels` + `watchPresence`); `convex-chat.ts:442-444`
  (`watchPresence` → `api.presence.list`); `packages/convex/convex/presence.ts:152-167`
  (`ctx.db.query("presence").collect()` — every row, no `take`);
  `packages/convex/convex/members.ts:263-280` (`ctx.db.query("members").collect()` and a
  `storage.getUrl` per member); `packages/core/src/chat/session.ts:158-167`
  (`ChatSession.start` opens a **second** presence subscription every client).
- Problem: the client pulls the full member list and the full presence table, keeps them in
  provider state, and rebuilds `memberNames`/`titles`/`avatarUrls` on every change
  (`use-chat-screen-data.ts:139-161`, `:224-233`), producing new identities that flow into
  every consumer (including M1's rows). Presence changes on every heartbeat from any member,
  so the app-wide context value changes at workspace heartbeat volume. The same presence
  query is also open a second time through `ChatSession.start` with no consumer.
- Impact at 100k: network — a full presence/member payload is re-materialized on each change
  rather than a delta, at roughly one change per heartbeat (30 s per active device); per-device
  — every heartbeat risks a full app-wide re-render plus `memberNames`/`titles` recomputation;
  100k-member workspaces make the initial payload and the members pane untenable.
- Effort: M (1–3 days for pagination + delta-shaped presence).
- Risk: Medium (permission/presence semantics must not change; `@mention` candidates need
  search-as-you-type instead of a full list).
- Proposed fix: paginate `members.list` and page/search the mention picker; make presence
  return `{ userId, status, customStatus }` deltas or scope it to conversation participants
  plus a bounded "recently online" set; drop the duplicate presence subscription in
  `ChatSession.start` (or have the provider read `session.presence()`); memoize `memberNames`
  on a presence version rather than array identity.

### M4. Empty-outbox flush every 5 s rewrites provider state and re-renders every consumer

- Evidence: `apps/mobile/src/providers/ChatProvider.tsx:253-267` (`setInterval(retry, 5000)`
  calling `flush()`), `:246-252` (`flush()` → `active.flush(...)` then `refreshOutbox()`),
  `:239-245` (`refreshOutbox` → `setOutbox(items)` with the array returned by
  `Outbox.list()`), `packages/core/src/outbox/index.ts:201-204`
  (`list()` returns `[...items].sort(...)` — always a new array), context value at
  `:504-567`.
- Problem: the retry timer runs unconditionally while the runtime is alive, even with nothing
  queued. Each tick reads AsyncStorage through the outbox store, builds a brand-new array, and
  calls `setOutbox`, which changes the memoized context value. Every component that consumes
  `useChat()` therefore re-renders 12×/minute forever, in the background state too (the
  interval is not gated on `AppState`).
- Impact at 100k: per-device — 12 needless full-subtree renders per minute, each re-running
  derivations over members/presence/channels; battery — an AsyncStorage read plus wakeups
  while idle; also masks real re-render regressions in profiling.
- Effort: S (< 1 hour).
- Risk: Low.
- Proposed fix: only set state when the list actually changed (`setOutbox(prev => sameItems(prev, items) ? prev : items)`)
  and skip the flush entirely when `await active.pendingCount() === 0`; use a longer/backoff
  cadence, and pause the timer while `AppState.currentState !== "active"`.

### M5. Typing sends a mutation per keystroke (web throttles; mobile does not)

- Evidence: `apps/mobile/src/components/chat/Composer.tsx:275-280`
  (`onChangeText` → `onTyping(channelId)` on every character),
  `apps/mobile/src/components/chat/ChatConversation.tsx:353-355`
  (`port.setTyping({ channelId })`), `apps/mobile/src/lib/convex-chat.ts:357-359`
  (a Convex mutation), `apps/mobile/src/components/chat/ThreadModal.tsx:182` (same pattern in
  threads). Compare web: `apps/web/src/components/chat/ChatView.tsx:382-388`
  (`createTypingThrottle`) and `:1067-1068` (`clearTyping` on send).
- Problem: one mutation per keystroke, no debounce, no throttle, and mobile never calls
  `clearTyping` (the port exposes it at `convex-chat.ts:360-363`). A 60-character message
  sends 60 mutations; a fast typist in a busy channel generates hundreds per minute. Each
  mutation invalidates `typing.list` for every other member in the channel.
- Impact at 100k: network — hundreds of extra mutations per active typist, and the resulting
  typing-row invalidation fans out to every other client in the channel; battery — radio
  wakeups per keystroke; server — mutation + presence-table churn per character.
- Effort: S (< 1 day; the web helper already exists and is shared-able).
- Risk: Low.
- Proposed fix: reuse the web `createTypingThrottle` (e.g. ping at most once per 2–3 s while
  typing) and call `port.clearTyping` on send, blur and channel switch.

### M6. Full-size images downloaded and base64-encoded per visible attachment

- Evidence: `apps/mobile/src/components/chat/AttachmentView.tsx:52-68`
  (`downloadAttachment(...)` then `data:${mime};base64,${bytesToBase64(bytes)}` for **every**
  image attachment, unconditionally on mount), `:164-169` (rendered into a 320×180 thumbnail),
  `packages/core/src/binary.ts:20-26` (`bytesToBase64` builds the string with one
  `binary += String.fromCharCode(byte)` per byte, then `btoa`).
- Problem: to draw a small thumbnail the client fetches the entire original (uploads are
  re-encoded up to 1 920 px / JPEG q0.82, so typically 100–600 KB) and converts it to a
  `data:` URI in JS. That doubles memory (bytes + per-byte JS string + base64 string) and the
  per-byte loop is one of the most expensive things the client does; it runs once per image
  row mounted, with no cache in front of it (each re-mount re-downloads) and no thumbnail
  variant anywhere in the pipeline. `Image` here is core RN with no cache/priority control,
  and no `expo-image` is installed (`apps/mobile/package.json`).
- Impact at 100k: per-device — multi-MB JS heap for a screenful of photos, visible scroll
  hitches and freezes proportional to image size; network — full originals over mobile data
  for thumbnails, repeated after cache eviction; server — egress amplification.
- Effort: M (2–4 days: needs a thumbnail/size-negotiation path).
- Risk: Medium (server/CDN change or client-side downscale + disk cache).
- Proposed fix: render from the downloaded file URI (already written by
  `cacheAttachmentFile`, `:18-38`) instead of a base64 data URI; add `expo-image` with a disk
  cache and `cachePolicy`; downscale/pre-generate server-side thumbnails and request them for
  inline rows; if base64 is unavoidable, base64-encode off the JS thread or use a native
  helper rather than the per-byte loop.

### M7. Members pane and channel hub render every row in a ScrollView, all three panes always mounted

- Evidence: `apps/mobile/src/components/chat/MembersPane.tsx:264-316` (one `ScrollView` with
  `MemberRows` mapping every filtered member, `useMemberRows` sort at `:216-230`),
  `apps/mobile/src/components/chat/ChannelList.tsx:379-440` (channel list) and `:51-99`
  (`HereNow` maps **every online member** and re-sorts with `statusIn` doing a linear
  `presence.find` inside the comparator, `:27-29`, `:53-60`), `DirectList.tsx:101-140`,
  `ThreadsInbox.tsx:80-130`, `SwipePanes.tsx:112-123` (left/center/right panes are always
  mounted, only translated).
- Problem: only one `FlatList` exists in the whole app (the message list,
  `grep -rn "FlatList" src`); every other list is a `ScrollView` that mounts all its children.
  The members pane for an open channel is the entire workspace (no `memberIds` scope,
  `MembersPane.tsx:210-214`), and it is permanently mounted behind the conversation. `HereNow`
  is O(members × presence) with a `find` per comparison inside `sort`, called on every render.
- Impact at 100k: per-device — thousands of mounted rows and avatar SVGs for large workspaces;
  memory and layout cost paid even while the user only reads chat; JS thread blocked on
  mount/filter/sort. Android is worse (no cell recycling, `overflow: hidden` clipping only).
- Effort: M (2–4 days).
- Risk: Medium (sections/scroll restoration and swipe-gesture interactions).
- Proposed fix: convert MembersPane, ChannelList/HereNow, DirectList and ThreadsInbox to
  `FlatList`/`SectionList` with `initialNumToRender`/`windowSize`/`removeClippedSubviews`;
  build a `Map` for presence once (`useMemo`) instead of `Array.find` in the comparator; cap
  `HereNow` to a windowed subset; consider unmounting/recycling panes that are two swipes away
  (or use `react-native-screens`' freeze).

### M8. Panel-level lists and the composer re-render on every parent update because props are rebuilt inline

- Evidence: `apps/mobile/src/components/chat/use-chat-screen-data.ts:424-435`
  (`attachmentsByMessage` is built in the render body, not in `useMemo`, and allocates a new
  `Map` on every render), `:461-473` (`mergedMessages` re-sorts all loaded messages), `:475-484`
  (`mergedDecrypted` rebuilds a map over history + decrypted + pending), `:139-161`
  (`memberNames` rebuilt whenever `presence` changes), `use-chat-screen-model.ts:5-9`
  (model = `{...data, ...actions}`, a new object every render flowing to all panes),
  `ChatScreen.tsx:163-205` (all panes take `model` whole).
- Problem: `useChatScreenModel` returns a new object each render, and it is threaded into
  `ChannelList`, `DirectList`, `MembersPane`, `SearchView`, `ChatConversation` and every sheet.
  Combined with the unmemoized attachments map and re-sorting, any parent render (presence,
  typing, call level, keystroke) re-renders the three panes and passes new collection
  identities down into the message list.
- Impact at 100k: per-device — re-render amplification far beyond what the data changed; the
  re-sort of up to `page × pages` messages per event (100 msg/page × N pages) is repeated
  needlessly.
- Effort: M (1–2 days).
- Risk: Low–Medium (mechanical, but wide).
- Proposed fix: `useMemo` `attachmentsByMessage` on `[messages, runtime]`; pass slices instead
  of the whole model to panes; keep `model` referentially stable by deriving it from memoized
  pieces; split the context so presence/voice/data are separate providers (see M3/M9).

### M9. Voice engine emits audio-level changes into the chat subtree several times per second

- Evidence: `apps/mobile/src/lib/voice/call-engine-core.ts:150-170` (`emit()` → the provider
  calls `setSnapshot(engine.getSnapshot())`, a brand-new object, at
  `apps/mobile/src/providers/voice-provider-engine.ts:133-135`),
  `apps/mobile/src/lib/voice/call-engine-media.ts:124-131` (500 ms `setInterval`
  `pollRemoteLevels` → `emit()` on any change > 0.02) and `:44-58` (mic level meter, 400 ms,
  calls `emit()` per reading), `apps/mobile/src/providers/voice-provider-controls.tsx:229-268`
  (new context value per snapshot), consumed high in the tree by
  `use-chat-screen-data.ts:37` (`useVoice()` inside `useConvexChatScreenSession`).
- Problem: `emit()` is called for every level poll even when only a number changed, and
  `getSnapshot()` always returns a fresh object, so the context value changes and every
  `useVoice()` consumer re-renders. Because `useVoice()` sits at the top of
  `useChatScreenData`, each emit re-runs the whole chat screen model (all three panes, the
  FlatList, derived maps) — ~2.5 Hz from the level hunt plus the meter while a call is up.
- Impact at 100k: per-device — during a call the app re-renders its largest subtree 2–5 times
  per second, on top of decoding audio; battery — avoidable CPU during calls, which are the
  most battery-sensitive moments.
- Effort: S–M (1–2 days).
- Risk: Medium (level meters and call UI must stay live; do not starve the ring state).
- Proposed fix: give levels their own context/store (e.g. a `useSyncExternalStore` selector or
  a dedicated `VoiceLevelsContext`) so level updates do not touch call/roster state; throttle
  emits to the display rate (or coalesce on `requestAnimationFrame`); keep `snapshot` stable
  when nothing but levels changed, and move `useVoice()` down to the components that need it.

### M10. Search backfill loops the entire workspace archive with no persistence and no cancellation

- Evidence: `apps/mobile/src/lib/use-search.ts:99-111` (`for (;;) { loadHistory(); setHits(await search(query)); if (complete) break; }`),
  `:86-112` (150 ms debounce per query, then the archive loop),
  `apps/mobile/src/providers/ChatProvider.tsx:160` + `:350-356`
  (`memorySearchStore()` — in-memory only on mobile) and `:225-236`
  (`onDecrypted` indexes the whole `latestMessages` list on every emit).
- Problem: the index is never persisted on mobile (unlike web's IndexedDB), so every app
  session starts empty; the first search then pages the server one 100-message page at a time
  across every channel (`packages/core/src/search/index.ts:318-352`, including full thread
  walks at `:354-374`), re-running the full `search(query)` after each page and setting state
  each time. There is no cap, priority or abort other than leaving the screen, and the loop
  keeps running after the query changes until the effect cleanup fires.
- Impact at 100k: network — thousands of sequential queries to index a large workspace, once
  per session that searches; per-device — JS-thread tokenization of every message plus a
  resident in-memory index; battery/data — heavy burst on mobile data. Every `receiveMessages`
  also walks all loaded messages to index them (`ChatProvider.tsx:228-235`).
- Effort: M (2–3 days).
- Risk: Medium (must not regress search completeness or leak decrypted text).
- Proposed fix: persist the index on device (SQLite/AsyncStorage-backed `SearchStore`, scoped
  by `searchScopeKey`), resume from stored cursors; run the backfill in a bounded worker with
  fewer, larger pages and a low-priority idle schedule; skip the re-`search` on every page and
  only re-run on page batch boundaries; index only newly seen ids in `onDecrypted` (track a
  seen set instead of re-iterating `latestMessages`).

### M11. Message history opens one live subscription per loaded page and re-sorts all pages on each emit

- Evidence: `apps/mobile/src/lib/use-channel.ts:71-103` (`subscribePage` per cursor, each held
  forever while the channel is open; `loadOlder` adds another),
  `:73-86` (every emit re-merges all pages into a `Map` and re-sorts the full list),
  `:104-115` (every emit rebuilds the whole `decrypted` map),
  `apps/mobile/src/lib/chat-runtime.ts:39-52` (`watchQuery` per page),
  `packages/core/src/chat/session.ts:216-241` (`receiveMessages` walks the list, notifies both
  listener sets).
- Problem: scrolling back N pages leaves N live Convex queries open for the active channel;
  each page's update re-merges and re-sorts the full message array (O(total) per event,
  O(pages) subscriptions each with its own re-run) and re-materializes the decrypted map. The
  notification listeners then iterate the entire merged list, and `ChatProvider`'s
  `onDecrypted` indexes each of those messages every time (`ChatProvider.tsx:224-237`).
- Impact at 100k: network/server — a long back-scroll leaves many live queries per client,
  each re-executing on any new message in the channel; per-device — O(total messages) sort and
  map rebuild per incoming message, growing the longer the user scrolls.
- Effort: M (2–3 days).
- Risk: Medium (pagination, jump-to-message and `hasOlder` semantics).
- Proposed fix: keep one live query on the newest page and fetch older pages on demand as
  snapshots (not subscriptions), merging incrementally (prepend) rather than re-sorting
  everything; scope `receiveMessages` notifications to the changed page; make `onDecrypted`
  indexing incremental.

### M12. Generated avatar SVG is rebuilt in render and remote avatars are full-size originals

- Evidence: `packages/avatars/src/native.tsx:70-81` (`<SvgXml xml={avatarSvg(seed, { size })} />`
  computed inside render, no memo) called from
  `apps/mobile/src/components/chat/MemberAvatar.tsx:19-28` for every row,
  `:72-77` (`Image source={{ uri: src }}` — the full original);
  `packages/convex/convex/members.ts:61-65` and `:255-258`
  (`ctx.storage.getUrl(member.avatarStorageId)` — the original upload, up to the client's 4 MB
  cap enforced at `ChatHubPane.tsx:240-243`).
- Problem: avatars appear in nearly every row (messages, member lists, search, threads,
  dock), and each render regenerates the blobatar geometry and re-parses the SVG string into
  native views. Workspace profile pictures are served as the original upload, so a 36 pt
  avatar can pull a multi-hundred-KB image, with no `expo-image` caching and no thumbnailing.
- Impact at 100k: per-device — avatar regeneration contributes directly to M1's re-render cost
  (every mounted row regenerates on every render); network — avatars dominate payload for list
  screens; memory — full-size bitmaps per avatar.
- Effort: S–M (avatar memo is hours; thumbnails are M).
- Risk: Low (memo) / Medium (thumbnail pipeline).
- Proposed fix: `useMemo(() => avatarSvg(seed, { size }), [seed, size])` inside
  `AvatarBody`, or precompute a data URI cache keyed by `(seed, size)`; add `React.memo` to
  `NativeAvatar`/`MemberAvatar`; store/serve a small avatar variant (e.g. 128 px) and switch
  to `expo-image` with a disk cache.

### M13. Smaller but real: unthrottled background timers, unused dependency/plugin surface, uncancelled audio players

- Evidence: `apps/mobile/src/components/QueryErrorBoundary.tsx:35-54` (unconditional
  `setInterval(retry, 4000)` that bumps state forever, including when the app is idle or
  backgrounded); `apps/mobile/src/components/voice/CallScreen.tsx:233-246` and
  `apps/mobile/src/components/kanban/parts.tsx:10-23` (1 s ticks while a call/timer is on —
  acceptable, noted for completeness); `apps/mobile/src/lib/notifications.ts:131`
  (`useIncomingCallNotification` depends on an inline `callerName` arrow created per render at
  `use-chat-screen-data.ts:163-166`, so the effect re-runs on every render);
  `apps/mobile/package.json` declares `expo-application`, `expo-constants`, `expo-system-ui`
  and `expo-secure-store` (plus its `app.json` plugin) with no import anywhere in `app/`,
  `src/` or `modules/` (`grep -rn` over those paths); `apps/mobile/src/lib/sounds.ts:162-170`
  exports `disposeSounds()` that nothing calls, while `:115-134` keeps up to 12
  `expo-audio` players alive.
- Problem: a 4 s no-op wakeup for the life of the session, an effect that re-runs per render
  in the chat tree, and dead dependency/plugin weight that also inflates native build and
  review surface.
- Impact at 100k: per-device — small but constant idle CPU/wakeups plus an extra render pass
  per 4 s; app size — a handful of unused modules and one native plugin.
- Effort: S (< 1 day).
- Risk: Low.
- Proposed fix: make the query-boundary retry event-driven only (connection state + AppState)
  or gate the interval on `AppState.currentState === "active"`; memoize `callerName` with
  `useCallback`; remove the unused deps/plugin after verifying nothing in the native projects
  references them; call `disposeSounds()` on sign-out.

### M14. Foreground local notifications fire for messages the user is already reading

- Evidence: `apps/mobile/src/lib/notifications.ts:41-88` (every new decrypted message outside
  the seed batch is announced locally, no check for the active channel),
  `apps/mobile/src/lib/push.ts:39-52` (`shouldShowBanner: true`, `shouldPlaySound` for calls
  only), `:79-87`.
- Problem: the notification path is not scoped to conversations the viewer is not looking at,
  and channel focus is not consulted (the hook is created in
  `use-chat-screen-data.ts:210-213` with `channelNames` but never the active id), so arriving
  messages in the open channel raise banners and increment the badge while the user watches
  them. Each message also schedules a separate notification rather than a grouped summary.
- Impact at 100k: per-device — redundant banners and badge churn during active use (battery
  via notification scheduling + user-visible noise); makes the badge count meaningless for
  anyone using the app.
- Effort: S (< 1 day).
- Risk: Low.
- Proposed fix: pass the active channel id (and `AppState`) into `useLocalNotifications` and
  skip/group announcements for the visible channel; use a notification summary/thread per
  channel and clear the badge when the channel is read.

## App size observations

Measured with `du`/`ls -l` in `apps/mobile`:

- Bundled assets are tiny: `assets/` is **128 KB total** — twelve WAV cues in
  `assets/sounds/` (`message`, `mention`, `call-ring`, `call-connect`, `call-join`,
  `call-leave`, each in a normal and a `-boosted` variant; largest `call-ring-boosted.wav`
  17.9 KB). There are **no bundled fonts** (the UI uses system fonts; no `expo-font`
  dependency) and **no ML/model files** anywhere in the app tree.
- Native image assets: `ios/` 328 KB (app icon 1024² 64 KB, splash/logos), `android/` 424 KB
  (`drawable-*/splashscreen_logo.png`, largest `xxxhdpi` 93 KB). Splash and icon art live only
  in the native projects, not in the JS asset graph.
- `app.json` has no `assetBundlePatterns`. With Expo SDK 50+ asset bundling follows the
  import graph, so this is not a hole by itself — worth an explicit, audited decision (or a
  documented default) because only `assets/sounds/*.wav` is imported, and half of those
  (`*-boosted`) are only reachable when the configured volume exceeds 100 %
  (`src/lib/sounds.ts:106-113`, `:146`).
- `packages/tokens/src` 56 KB (icon path table shared with web), `packages/avatars/src`
  small; both are plain TS bundled by Metro.
- Unused declared dependencies (no import in `app/`, `src/`, `modules/`, `babel.config.js`,
  `metro.config.js`): `expo-application`, `expo-constants`, `expo-system-ui`,
  `expo-secure-store` (also registered as an `app.json` plugin). `react-native-screens` and
  `@expo/metro-runtime` must stay (Expo Router / React Navigation peers).
- Build config: `metro.config.js` watches the monorepo root and re-resolves `.js` → extensionless
  specifiers for the `@aulora/*` TS packages (needed for this workspace); `babel.config.js`
  uses `babel-preset-expo` with `jsxImportSource: "nativewind"` **plus** a `"nativewind/babel"`
  preset entry — with NativeWind 4 the jsx import source is the supported mechanism, so the
  extra preset should be re-verified against the installed NativeWind version (dependencies
  were not installed in this checkout, so it could not be confirmed).
- No bundle was present (`apps/mobile/dist` empty), so JS bundle size could not be measured
  here; the message-thread findings above (single FlatList, fully-mounted panes) are the
  larger runtime-size risk than asset weight.

## Already-good notes

- Plaintext architecture: the client holds no keys and does no crypto (`chat-runtime.ts:8-15`,
  `use-channel.ts:23-28`); nothing decryption-related runs on the JS thread, so the "heavy
  decryption" risk does not apply.
- The message FlatList is correctly inverted with a stable `keyExtractor`, memoized
  `buildMessageRows`, `keyboardShouldPersistTaps`, `onEndReachedThreshold`, an
  `onScrollToIndexFailed` fallback and a scroll-to-unread pill (`MessageList.tsx:267`,
  `:287-316`, `message-rows.ts:38-63`).
- `ChatSession` caches resolved file descriptors and per-message attachment lists, and caches
  missing files as `null` so live ticks never re-fetch metadata
  (`packages/core/src/chat/session.ts:124-138`, `:242-300`); `onDecrypted` listeners are
  properly unsubscribed on cleanup (`session.ts:318-325`, `use-channel.ts:104-123`).
- Voice teardown is thorough and leak-free: `enterTeardown` clears the call/signal
  subscriptions and both intervals, closes every peer after nulling its handlers, removes
  tracks from streams, stops mic/camera/screen tracks and resets state
  (`call-engine-core.ts:296-326`, `call-engine.ts:321-342`); `dispose()` is called on
  unmount (`voice-provider-engine.ts:139-145`). `RemoteAudio` correctly re-applies deafen/volume
  on stream changes (`voice-provider-controls.tsx:322-343`).
- Presence heartbeat is AppState-aware, uses a single 30 s interval, is idempotent on
  foreground, and cleanly removes its listener and interval
  (`use-presence-heartbeat.ts:18-42`); typing/system rows expire server-side
  (`packages/convex/convex/typing.ts:7-10`, `crons.ts`).
- Transport is subscription-based, not polling: channels, messages, reactions, presence,
  typing, read state and signals are all Convex live queries
  (`convex-chat.ts:374-451`, `convex-voice.ts:98-135`); push uses native APNs/FCM tokens with
  opaque payloads and no hosted service (`push.ts:7-29`), and push registration no-ops on
  simulators and on permission denial (`use-push-registration.ts:35-66`).
- `usePalette()` returns one of two module-level constant palettes
  (`packages/ui-native/src/colors.ts:18-21`), so palette identity is stable and safe as a memo
  dependency; `useReduceMotion` honours the OS accessibility preference with a module-level
  cache and a removed listener (`use-entrance.ts:14-36`); `SwipePanes` keeps all animation in
  worklets with `scheduleOnRN` only at gesture end (`SwipePanes.tsx:75-106`).
- Offline outbox is persisted per server+account, retries with exponential backoff to a
  `failed` state, and refuses to flush while backgrounded
  (`outbox/index.ts:250-290`, `outbox-store.ts:9-41`, `ChatProvider.tsx:249`).
- Uploads are re-encoded (EXIF stripped) and bounded to a 1 920 px edge at q0.82
  (`attachments.ts:25-56`), which keeps originals reasonable for the thumbnail problem in M6.
