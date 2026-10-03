// DOM rendering for the in-page demo. Every builder takes the shared demo
// context (state, element handles, and handlers) and leaves behaviour to
// demo.js. Functions are kept short so each one stays easy to follow.

import { person, REACTIONS } from "./demo-data.js";

function icon(ctx, name) {
  const source = ctx.root.querySelector(`[data-icon="${name}"] svg`);
  return source ? source.cloneNode(true) : document.createElement("span");
}

function avatar(ctx, seed, server = false) {
  const selector = server ? ".avatar-server" : ":not(.avatar-server)";
  const source = ctx.root.querySelector(`[data-avatar="${seed}"] .avatar${selector}`);
  if (!source) {
    const fallback = document.createElement("span");
    fallback.className = server ? "avatar avatar-server" : "avatar";
    return fallback;
  }
  return source.cloneNode(true);
}

function rowButton(className, current, onClick, children) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  if (current) button.setAttribute("aria-current", "true");
  button.addEventListener("click", onClick);
  button.append(...children);
  return button;
}

function listLabel(ctx, text) {
  const label = document.createElement("p");
  label.className = "app-label";
  label.append(icon(ctx, "chevron-down"), document.createTextNode(text));
  ctx.dom.list.append(label);
}

function renderWorkspace(ctx) {
  const ws = ctx.workspace();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ws-header";
  button.setAttribute("aria-expanded", String(!ctx.dom.wsPop.hidden));
  button.setAttribute("aria-haspopup", "menu");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = ws.name;
  const online = document.createElement("small");
  const dot = document.createElement("i");
  dot.className = "presence";
  online.append(dot, document.createTextNode(`${ws.online} online`));
  copy.append(title, online);
  button.append(avatar(ctx, ws.id, true), copy, icon(ctx, "chevron-down"));
  button.addEventListener("click", () => {
    ctx.dom.wsPop.hidden = !ctx.dom.wsPop.hidden;
    button.setAttribute("aria-expanded", String(!ctx.dom.wsPop.hidden));
  });
  ctx.dom.workspaceSlot.replaceChildren(button);
}

function renderSwitchMenu(ctx) {
  const menu = ctx.dom.wsPop;
  menu.replaceChildren();
  for (const ws of ctx.workspaces) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ws.id === ctx.state.workspaceId ? "is-current" : "";
    button.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = ws.name;
    const host = document.createElement("small");
    host.textContent = ws.host;
    label.append(title, host);
    button.append(avatar(ctx, ws.id, true), label);
    button.addEventListener("click", () => ctx.switchWorkspace(ws.id));
    menu.append(button);
  }
}

function renderChannelRows(ctx, ws, query) {
  for (const channel of ws.channels) {
    if (query && !channel.name.includes(query)) continue;
    const name = document.createElement("span");
    name.textContent = channel.name;
    const bits = [icon(ctx, channel.kind === "announce" ? "announce" : "hash"), name];
    if (channel.unread) {
      const badge = document.createElement("b");
      badge.className = "badge";
      badge.textContent = String(channel.unread);
      bits.push(badge);
    } else if (channel.dot) {
      const dot = document.createElement("i");
      dot.className = "unread-dot";
      bits.push(dot);
    }
    const active = ctx.state.pane === "channel" && ctx.state.channelId === channel.id;
    const extra = channel.unread || channel.dot ? " is-unread" : "";
    ctx.dom.list.append(
      rowButton(
        `app-row${active ? " is-active" : ""}${extra}`,
        active,
        () => ctx.openConversation("channel", channel.id),
        bits,
      ),
    );
  }
}

function renderVoiceRows(ctx, ws, query) {
  if (ws.voice.length === 0) return;
  listLabel(ctx, "Voice");
  for (const channel of ws.voice) {
    if (query && !channel.name.includes(query)) continue;
    const name = document.createElement("span");
    name.textContent = channel.name;
    const people = document.createElement("span");
    people.className = "in-call";
    const joined = ctx.state.call?.workspaceId === ws.id && ctx.state.call.channelId === channel.id;
    const members = joined ? [...channel.members, "me"] : channel.members;
    for (const member of members) people.append(avatar(ctx, member));
    const active = ctx.state.pane === "voice" && ctx.state.channelId === channel.id;
    ctx.dom.list.append(
      rowButton(
        `app-row${active ? " is-active" : ""}`,
        active,
        () => ctx.openConversation("voice", channel.id),
        [icon(ctx, "volume"), name, people],
      ),
    );
  }
}

function renderDmRows(ctx, ws, query) {
  for (const dm of ws.dms) {
    if (query && !dm.name.toLowerCase().includes(query)) continue;
    const label = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = dm.name;
    const presence = document.createElement("small");
    presence.textContent = dm.status;
    label.append(title, presence);
    const active = ctx.state.pane === "dm" && ctx.state.channelId === dm.id;
    ctx.dom.list.append(
      rowButton(
        `app-dm${active ? " is-active" : ""}`,
        active,
        () => ctx.openConversation("dm", dm.id),
        [avatar(ctx, dm.user), label],
      ),
    );
  }
}

export function renderList(ctx) {
  const ws = ctx.workspace();
  const query = (ctx.dom.search?.value ?? "").trim().toLowerCase();
  ctx.dom.list.replaceChildren();
  listLabel(ctx, "Channels");
  renderChannelRows(ctx, ws, query);
  renderVoiceRows(ctx, ws, query);
  listLabel(ctx, "Direct messages");
  renderDmRows(ctx, ws, query);
  if (query && ctx.dom.list.querySelector("button") === null) {
    const empty = document.createElement("p");
    empty.className = "demo-empty";
    empty.textContent = "Nothing matches.";
    ctx.dom.list.append(empty);
  }
}

function reactionButtons(ctx, message) {
  const wrap = document.createElement("p");
  wrap.className = "reactions";
  for (const reaction of message.reactions) {
    const button = document.createElement("button");
    button.type = "button";
    if (reaction.mine) button.className = "mine";
    button.textContent = `${reaction.emoji} ${reaction.count}`;
    const suffix = reaction.mine ? ", yours" : "";
    button.setAttribute("aria-label", `${reaction.emoji}, ${reaction.count}${suffix}`);
    button.addEventListener("click", () => ctx.toggleReaction(message, reaction.emoji));
    wrap.append(button);
  }
  wrap.append(reactionPickerButton(ctx, message));
  if (ctx.state.pickerId === message.id) wrap.append(reactionChoices(ctx, message));
  return wrap;
}

function reactionPickerButton(ctx, message) {
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-reaction";
  add.setAttribute("aria-label", "Add reaction");
  add.append(icon(ctx, "smile"));
  add.addEventListener("click", () => ctx.setReactionPicker(message.id));
  return add;
}

function reactionChoices(ctx, message) {
  const choices = document.createElement("span");
  choices.className = "react-choices";
  for (const [emoji, label] of REACTIONS) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = emoji;
    choice.setAttribute("aria-label", label);
    choice.addEventListener("click", () => ctx.toggleReaction(message, emoji));
    choices.append(choice);
  }
  return choices;
}

function messageMeta(message) {
  const who = person(message.user);
  const meta = document.createElement("p");
  meta.className = "msg-meta";
  const name = document.createElement("strong");
  name.textContent = who.name;
  if (who.color) name.style.color = who.color;
  const time = document.createElement("time");
  time.textContent = message.time;
  meta.append(name, time);
  return meta;
}

function messageFace(ctx, message) {
  const who = person(message.user);
  const face = avatar(ctx, message.user);
  if (!who.color) return face;
  const ring = document.createElement("span");
  ring.className = "ring";
  ring.style.setProperty("--ring", who.color);
  ring.append(face);
  return ring;
}

export function renderMessage(ctx, message, { threaded = false } = {}) {
  const row = document.createElement("div");
  row.className = message.fresh ? "msg is-new" : "msg";
  const body = document.createElement("div");
  const text = document.createElement("p");
  text.textContent = message.text;
  body.append(messageMeta(message), text, reactionButtons(ctx, message));
  if (!threaded && message.replies.length > 0) body.append(threadLink(ctx, message));
  row.append(messageFace(ctx, message), body);
  return row;
}

function threadLink(ctx, message) {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "thread-link";
  const count = document.createElement("span");
  const noun = message.replies.length === 1 ? "reply" : "replies";
  count.textContent = `${message.replies.length} ${noun}`;
  link.append(icon(ctx, "thread"), count);
  link.addEventListener("click", () => ctx.openThread(message.id));
  return link;
}

function conversationTile(ctx, channel) {
  const tile = document.createElement("span");
  tile.className = "tile";
  if (ctx.state.pane === "dm") tile.append(avatar(ctx, channel.user));
  else if (ctx.state.pane === "voice") tile.append(icon(ctx, "volume"));
  else tile.append(icon(ctx, channel.kind === "announce" ? "announce" : "hash"));
  return tile;
}

function renderHeader(ctx, channel) {
  const header = ctx.dom.header;
  header.replaceChildren();
  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "demo-nav";
  menu.setAttribute("aria-label", "Conversations");
  menu.append(icon(ctx, "menu"));
  menu.addEventListener("click", () => ctx.root.classList.toggle("is-nav-open"));
  const title = document.createElement("span");
  title.className = "convo-title";
  const name = document.createElement("strong");
  name.textContent = channel.name;
  const sub = document.createElement("small");
  sub.textContent =
    ctx.state.pane === "dm"
      ? channel.status
      : ctx.state.pane === "voice"
        ? "Voice channel"
        : `${channel.members} members`;
  title.append(name, sub);
  const tools = document.createElement("span");
  tools.className = "app-tools";
  tools.append(icon(ctx, "pin"), icon(ctx, "search"), icon(ctx, "users"));
  header.append(menu, conversationTile(ctx, channel), title, tools);
}

function renderDay(ctx, day) {
  const label = document.createElement("p");
  label.className = "day";
  const span = document.createElement("span");
  span.textContent = day;
  label.append(span);
  ctx.dom.transcript.append(label);
}

function typingRow(ctx) {
  const typing = document.createElement("p");
  typing.className = "typing";
  typing.append(
    document.createElement("i"),
    document.createElement("i"),
    document.createElement("i"),
  );
  typing.append(document.createTextNode("Someone is typing"));
  ctx.dom.transcript.append(typing);
}

function renderTranscript(ctx) {
  const transcript = ctx.dom.transcript;
  const gap = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
  const wasAtBottom = ctx.state.forceBottom || gap < 48;
  ctx.state.forceBottom = false;
  transcript.replaceChildren();
  let lastDay = null;
  for (const message of ctx.messages.get(ctx.currentKey()) ?? []) {
    if (message.day !== lastDay) {
      renderDay(ctx, message.day);
      lastDay = message.day;
    }
    transcript.append(renderMessage(ctx, message));
    message.fresh = false;
  }
  if (ctx.state.typingKey === ctx.currentKey()) typingRow(ctx);
  if (wasAtBottom) {
    transcript.scrollTop = transcript.scrollHeight;
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  } else {
    transcript.scrollTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight - gap);
  }
  updateJump(ctx);
}

function renderVoiceRoom(ctx, channel, ws) {
  const room = document.createElement("div");
  room.className = "voice-room";
  const heading = document.createElement("p");
  heading.textContent = `In #${channel.name} at ${ws.name}.`;
  room.append(heading);
  const joined = ctx.state.call?.workspaceId === ws.id && ctx.state.call.channelId === channel.id;
  const members = joined ? [...channel.members, "me"] : [...channel.members];
  const faces = document.createElement("div");
  faces.className = "voice-people";
  for (const member of members) {
    const row = document.createElement("p");
    const who = document.createElement("span");
    who.textContent = person(member).name;
    row.append(avatar(ctx, member), who);
    faces.append(row);
  }
  room.append(faces);
  room.append(callButton(ctx, joined));
  ctx.dom.transcript.append(room);
}

function callButton(ctx, joined) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "button button-primary";
  action.textContent = joined ? "Leave" : "Join";
  action.addEventListener("click", () => ctx.toggleCall());
  return action;
}

function renderComposer(ctx, channel) {
  const readOnly = ctx.state.pane === "voice" || channel.post === false;
  ctx.dom.composer.hidden = ctx.state.pane === "voice";
  ctx.dom.input.disabled = readOnly;
  if (ctx.state.pane === "dm") ctx.dom.input.placeholder = `Message ${channel.name}`;
  else if (channel.post === false)
    ctx.dom.input.placeholder = "You can't post in this announcement channel.";
  else ctx.dom.input.placeholder = `Message #${channel.name}`;
  ctx.syncSend();
}

export function renderConversation(ctx) {
  const channel = ctx.currentChannel();
  renderHeader(ctx, channel);
  if (ctx.state.pane === "voice") renderVoiceRoom(ctx, channel, ctx.workspace());
  else renderTranscript(ctx);
  renderComposer(ctx, channel);
  renderThread(ctx);
}

export function renderThread(ctx) {
  const thread = ctx.dom.thread;
  const parent = (ctx.messages.get(ctx.currentKey()) ?? []).find(
    (item) => item.id === ctx.state.threadId,
  );
  if (!parent) {
    thread.hidden = true;
    ctx.root.classList.remove("is-thread");
    return;
  }
  thread.hidden = false;
  ctx.root.classList.add("is-thread");
  thread.replaceChildren();
  const bar = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "Thread";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close thread");
  close.append(icon(ctx, "x"));
  close.addEventListener("click", () => ctx.closeThread());
  bar.append(title, close);
  const stream = document.createElement("div");
  stream.className = "thread-stream";
  stream.append(renderMessage(ctx, parent, { threaded: true }));
  for (const reply of parent.replies) stream.append(renderMessage(ctx, reply, { threaded: true }));
  const note = document.createElement("p");
  note.className = "thread-hint";
  note.textContent = "Replies stay on this message.";
  thread.append(bar, stream, note);
}

export function updateJump(ctx) {
  const jump = ctx.dom.jump;
  if (!jump) return;
  const transcript = ctx.dom.transcript;
  const gap = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
  const hasOverflow = transcript.scrollHeight > transcript.clientHeight + 4;
  jump.hidden = !hasOverflow || gap < 48;
}

export function render(ctx) {
  renderWorkspace(ctx);
  renderSwitchMenu(ctx);
  renderList(ctx);
  renderConversation(ctx);
}
