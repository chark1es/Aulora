// In-page Aulora demo: state, handlers, and event wiring. Messages never leave
// the tab. Rendering lives in demo-view.js and the seeded data in demo-data.js.

import { clock, createWorkspaces, msg, person, replyFor, seedMessages } from "./demo-data.js";
import { render, renderList, updateJump } from "./demo-view.js";

export { replyFor } from "./demo-data.js";

function makeState() {
  return {
    workspaceId: "acme-studio",
    pane: "channel",
    channelId: "ops",
    threadId: null,
    pickerId: null,
    call: null,
    typingKey: null,
    replyStep: 0,
    navOpen: false,
    forceBottom: true,
  };
}

function queryDom(root) {
  return {
    list: root.querySelector("[data-demo-list]"),
    workspaceSlot: root.querySelector("[data-demo-workspace]"),
    header: root.querySelector("[data-demo-header]"),
    transcript: root.querySelector("[data-demo-messages]"),
    composer: root.querySelector("[data-demo-composer]"),
    input: root.querySelector("[data-demo-input]"),
    send: root.querySelector("[data-demo-send]"),
    thread: root.querySelector("[data-demo-thread]"),
    status: root.querySelector("[data-demo-status]"),
    search: root.querySelector("[data-demo-search]"),
    fileInput: root.querySelector("[data-demo-file-input]"),
    wsPop: root.querySelector("[data-demo-ws-pop]"),
    jump: root.querySelector("[data-demo-jump]"),
  };
}

function currentChannel(ctx) {
  const ws = ctx.workspace();
  if (ctx.state.pane === "dm") return ws.dms.find((item) => item.id === ctx.state.channelId);
  if (ctx.state.pane === "voice") return ws.voice.find((item) => item.id === ctx.state.channelId);
  return ws.channels.find((item) => item.id === ctx.state.channelId);
}

function setStatus(ctx, text) {
  if (ctx.dom.status) ctx.dom.status.textContent = text;
}

function openConversation(ctx, pane, id) {
  Object.assign(ctx.state, {
    pane,
    channelId: id,
    threadId: null,
    pickerId: null,
    forceBottom: true,
  });
  const channel = currentChannel(ctx);
  if (channel && "unread" in channel) channel.unread = 0;
  if (channel && "dot" in channel) channel.dot = false;
  ctx.root.classList.remove("is-nav-open");
  render(ctx);
  ctx.dom.input?.focus();
}

function pushMessage(ctx, targetKey, entry, parentId) {
  let bucket = ctx.messages.get(targetKey);
  if (!bucket) {
    bucket = [];
    ctx.messages.set(targetKey, bucket);
  }
  if (!parentId) {
    bucket.push(entry);
    return;
  }
  const parent = bucket.find((item) => item.id === parentId);
  if (parent) parent.replies.push(entry);
}

function scheduleReply(ctx, targetKey, channelId, text, workspaceId, parentId) {
  window.clearTimeout(ctx.replyTimer);
  ctx.state.typingKey = targetKey;
  render(ctx);
  ctx.replyTimer = window.setTimeout(() => {
    const reply = replyFor(workspaceId, channelId, text, ctx.state.replyStep);
    ctx.state.replyStep += 1;
    const entry = msg(reply.user, reply.text, clock());
    entry.fresh = true;
    pushMessage(ctx, targetKey, entry, parentId);
    if (!parentId && ctx.currentKey() !== targetKey) bumpUnread(ctx, targetKey);
    ctx.state.typingKey = null;
    render(ctx);
    setStatus(ctx, `${person(reply.user).name} replied.`);
  }, 850);
}

function bumpUnread(ctx, targetKey) {
  const [wsId, id] = targetKey.split(":");
  const channel = ctx.workspaces
    .find((item) => item.id === wsId)
    ?.channels.find((item) => item.id === id);
  if (channel) channel.unread = (channel.unread ?? 0) + 1;
}

function sendCurrent(ctx) {
  const text = ctx.dom.input.value.trim();
  const channel = currentChannel(ctx);
  if (!text || !channel || channel.post === false || ctx.state.pane === "voice") return;
  const entry = msg("me", text, clock());
  entry.fresh = true;
  const targetKey = ctx.currentKey();
  const parentId = ctx.state.threadId;
  pushMessage(ctx, targetKey, entry, parentId);
  ctx.dom.input.value = "";
  ctx.state.forceBottom = true;
  syncSend(ctx);
  setStatus(ctx, "Sent.");
  render(ctx);
  scheduleReply(ctx, targetKey, ctx.state.channelId, text, ctx.state.workspaceId, parentId);
}

function toggleReaction(ctx, message, emoji) {
  const existing = message.reactions.find((item) => item.emoji === emoji);
  if (existing?.mine) {
    existing.mine = false;
    existing.count -= 1;
    if (existing.count <= 0) {
      message.reactions = message.reactions.filter((item) => item !== existing);
    }
  } else if (existing) {
    existing.mine = true;
    existing.count += 1;
  } else {
    message.reactions.push({ emoji, count: 1, mine: true });
  }
  ctx.state.pickerId = null;
  render(ctx);
}

function switchWorkspace(ctx, id) {
  const ws = ctx.workspaces.find((item) => item.id === id);
  if (!ws) return;
  Object.assign(ctx.state, {
    workspaceId: ws.id,
    pane: "channel",
    channelId: ws.channels[0].id,
    threadId: null,
    pickerId: null,
    forceBottom: true,
  });
  ctx.dom.wsPop.hidden = true;
  if (ctx.dom.search) ctx.dom.search.value = "";
  setStatus(ctx, `${ws.name}. Separate account, separate server.`);
  render(ctx);
}

function toggleCall(ctx) {
  const ws = ctx.workspace();
  const channel = ctx.currentChannel();
  const joined = ctx.state.call?.workspaceId === ws.id && ctx.state.call.channelId === channel.id;
  ctx.state.call = joined ? null : { workspaceId: ws.id, channelId: channel.id };
  const verb = joined ? "Left" : "Joined";
  const tail = joined ? "" : " No microphone in this demo.";
  setStatus(ctx, `${verb} ${channel.name}.${tail}`);
  render(ctx);
}

function openThread(ctx, id) {
  ctx.state.threadId = id;
  ctx.state.pickerId = null;
  render(ctx);
}

function closeThread(ctx) {
  ctx.state.threadId = null;
  render(ctx);
}

function setReactionPicker(ctx, id) {
  ctx.state.pickerId = ctx.state.pickerId === id ? null : id;
  render(ctx);
}

function pickLatestReaction(ctx) {
  const bucket = ctx.messages.get(ctx.currentKey()) ?? [];
  const latest = ctx.state.threadId
    ? bucket.find((item) => item.id === ctx.state.threadId)
    : bucket[bucket.length - 1];
  if (latest) setReactionPicker(ctx, latest.id);
}

function attachFile(ctx, name) {
  const entry = msg(
    "me",
    `Attached ${name}. This demo keeps the name and drops the file.`,
    clock(),
  );
  entry.fresh = true;
  pushMessage(ctx, ctx.currentKey(), entry, Boolean(ctx.state.threadId));
  ctx.state.forceBottom = true;
  setStatus(ctx, `Attached ${name}.`);
  render(ctx);
}

function insertTool(ctx, kind) {
  if (ctx.dom.input.disabled) return;
  const input = ctx.dom.input;
  if (kind === "code") {
    const space = input.value.endsWith(" ") || input.value === "" ? "" : " ";
    input.value = `${input.value}${space}\`code\``;
  } else if (kind === "mention") input.value += "@";
  else if (kind === "channel") input.value += "#";
  else setStatus(ctx, "Drop a file on the composer. This demo keeps the name only.");
  syncSend(ctx);
  input.focus();
}

function syncSend(ctx) {
  ctx.dom.send.disabled = ctx.dom.input.disabled || ctx.dom.input.value.trim() === "";
}

function dismissOverlays(ctx) {
  const open = ctx.state.threadId !== null || ctx.state.pickerId !== null || !ctx.dom.wsPop.hidden;
  ctx.dom.wsPop.hidden = true;
  ctx.state.pickerId = null;
  ctx.state.threadId = null;
  if (open) render(ctx);
}

function wireSearch(ctx) {
  const { search } = ctx.dom;
  search.addEventListener("input", () => renderList(ctx));
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    search.value = "";
    renderList(ctx);
    search.blur();
  });
}

function wireComposer(ctx) {
  const { input, send, fileInput, composer } = ctx.dom;
  input.addEventListener("input", () => syncSend(ctx));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent(ctx);
    }
  });
  send.addEventListener("click", () => sendCurrent(ctx));
  ctx.root
    .querySelector("[data-demo-emoji]")
    .addEventListener("click", () => pickLatestReaction(ctx));
  ctx.root.querySelector("[data-demo-file]").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file && !input.disabled) attachFile(ctx, file.name);
  });
  composer.addEventListener("dragover", (event) => event.preventDefault());
  composer.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file || input.disabled) {
      setStatus(ctx, "This channel doesn't take files.");
      return;
    }
    attachFile(ctx, file.name);
  });
}

function wireTools(ctx) {
  for (const tool of ctx.root.querySelectorAll("[data-demo-tool]")) {
    tool.addEventListener("click", () => insertTool(ctx, tool.dataset.demoTool));
  }
}

function wireKeyboard(ctx) {
  const { search } = ctx.dom;
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (event.key === "Escape") dismissOverlays(ctx);
  });
}

function wireGlobal(ctx) {
  const { transcript, jump, wsPop, workspaceSlot } = ctx.dom;
  transcript.addEventListener("scroll", () => updateJump(ctx));
  jump?.addEventListener("click", () => {
    transcript.scrollTop = transcript.scrollHeight;
    updateJump(ctx);
  });
  document.addEventListener("click", (event) => {
    if (!workspaceSlot.contains(event.target) && !wsPop.contains(event.target)) wsPop.hidden = true;
  });
  const kbd = ctx.root.querySelector(".app-search kbd");
  if (kbd && !/Mac/i.test(navigator.platform ?? "")) kbd.textContent = "Ctrl K";
}

function bindHandlers(ctx) {
  ctx.setStatus = (text) => setStatus(ctx, text);
  ctx.openConversation = (pane, id) => openConversation(ctx, pane, id);
  ctx.toggleReaction = (message, emoji) => toggleReaction(ctx, message, emoji);
  ctx.switchWorkspace = (id) => switchWorkspace(ctx, id);
  ctx.toggleCall = () => toggleCall(ctx);
  ctx.openThread = (id) => openThread(ctx, id);
  ctx.closeThread = () => closeThread(ctx);
  ctx.setReactionPicker = (id) => setReactionPicker(ctx, id);
  ctx.sendCurrent = () => sendCurrent(ctx);
  ctx.syncSend = () => syncSend(ctx);
}

function createContext(root) {
  const ctx = {
    root,
    dom: queryDom(root),
    state: makeState(),
    workspaces: createWorkspaces(),
    messages: seedMessages(),
    replyTimer: 0,
  };
  ctx.workspace = () => ctx.workspaces.find((item) => item.id === ctx.state.workspaceId);
  ctx.currentKey = () => `${ctx.state.workspaceId}:${ctx.state.channelId}`;
  ctx.currentChannel = () => currentChannel(ctx);
  bindHandlers(ctx);
  return ctx;
}

export function mountDemo(root) {
  const ctx = createContext(root);
  render(ctx);
  wireSearch(ctx);
  wireComposer(ctx);
  wireTools(ctx);
  wireKeyboard(ctx);
  wireGlobal(ctx);
}
