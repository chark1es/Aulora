/** Exceptions describe local decoration/media, never interactive window content. */
export const layoutExceptions: Record<string, string> = {
  "src/components/BlobBackdrop.tsx": "Clipped decorative artwork; no text or controls.",
  "src/components/AuthScaffold.tsx":
    "Scroll-edge fade is anchored to the form scroller's own top, already below the safe area; no text or controls.",
  "src/components/SignInForm.tsx":
    "Absolute underline stays inside its already inset auth tab control.",
  "src/components/chat/PresenceAvatar.tsx":
    "Presence dot is anchored to an avatar, not the window.",
  "src/components/chat/List.tsx": "Unread dot is anchored in reserved row gutter.",
  "src/components/voice/CallScreen.tsx":
    "Participant labels are anchored inside video tiles; full-screen controls use window insets. PiP has only video/avatar, no text or controls.",
  "src/components/chat/HubPane.tsx":
    "Tab counters and workspace chevron are anchored to icons; the dock uses insets and matching clearance.",
  "src/components/chat/DockTab.tsx":
    "The tab's mention counter is anchored to its glyph, not the window.",
  "src/components/kanban/CardTile.tsx":
    "Card menu is anchored inside a tile; title reserves its trailing gutter.",
  "src/components/chat/MessageList.tsx":
    "Jump-to-latest is local to the message viewport below the safe-area header.",
  "src/components/chat/GroupAvatar.tsx":
    "Second avatar is positioned within the group avatar frame.",
};
