// In-page Aulora demo. Messages never leave the tab. Avatars and icons are
// cloned from the build-time asset bin inside [data-demo].

const PEOPLE = {
  me: { name: "You", color: null },
  "u-ludmil": { name: "Ludmil Popov", color: null },
  "u-kathryn": { name: "Kathryn Murphy", color: "#7c5cff" },
  "u-jacob": { name: "Jacob Jones", color: "#0e9f8e" },
  "u-savannah": { name: "Savannah Nguyen", color: null },
  "u-theresa": { name: "Theresa Webb", color: null },
  "u-leslie": { name: "Leslie Alexander", color: null },
  "u-marvin": { name: "Marvin McKinney", color: null },
  "u-wade": { name: "Wade Warren", color: null },
};

const REACTIONS = [
  ["👍", "Thumbs up"],
  ["🔑", "Key"],
  ["👀", "Eyes"],
];

let nextMessageId = 1;

function messageId() {
  nextMessageId += 1;
  return `m${nextMessageId}`;
}

function clock(date = new Date()) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function replyFor(workspaceId, channelId, text, step) {
  const lower = text.toLowerCase();
  if (workspaceId === "acme-studio") {
    if (/backup|snapshot|key/.test(lower)) {
      return {
        user: "u-jacob",
        text: "Nightly snapshots, copied off the machine. The key stays in the password manager, not on the box.",
      };
    }
    if (/audit/.test(lower)) {
      return {
        user: "u-kathryn",
        text: "I'll want the backup drill in writing before anyone external reads it.",
      };
    }
    if (channelId === "design") {
      return {
        user: "u-kathryn",
        text: "Put the longer version in a thread so #design stays scannable.",
      };
    }
  }
  if (workspaceId === "lumen" && /key|token|secret|password/.test(lower)) {
    return { user: "u-wade", text: "Don't paste secrets here. Password manager." };
  }
  if (workspaceId === "makers") {
    const pool = [
      { user: "u-theresa", text: "I'll put that on the board for tonight." },
      { user: "u-leslie", text: "Doors are still 7. Bring whatever you're mid-project on." },
    ];
    return pool[step % pool.length];
  }
  if (workspaceId === "lumen") {
    const pool = [
      { user: "u-marvin", text: "I'll check it on the preview after this build." },
      { user: "u-savannah", text: "Noted. I'll reply once the deploy finishes." },
    ];
    return pool[step % pool.length];
  }
  const pool = [
    { user: "u-savannah", text: "Got it. I'll pick this up after standup." },
    { user: "u-ludmil", text: "Noted. I'll look at the closet server after lunch." },
    { user: "u-jacob", text: "I'll add the detail in the thread if I find the log." },
  ];
  return pool[step % pool.length];
}

function createWorkspaces() {
  return [
    {
      id: "acme-studio",
      name: "Acme Studio",
      host: "chat.acme.studio",
      online: 7,
      channels: [
        { id: "general", name: "general", kind: "text", members: 18 },
        { id: "announcements", name: "announcements", kind: "announce", members: 40, post: false },
        { id: "ops", name: "ops", kind: "text", members: 6 },
        { id: "design", name: "design", kind: "text", members: 8, unread: 2 },
        { id: "random", name: "random", kind: "text", members: 40, dot: true },
      ],
      voice: [{ id: "standup", name: "standup", members: ["u-theresa", "u-ludmil"] }],
      dms: [
        {
          id: "dm-jacob",
          name: "Jacob Jones",
          user: "u-jacob",
          status: "Online",
          presence: "online",
        },
        {
          id: "dm-savannah",
          name: "Savannah Nguyen",
          user: "u-savannah",
          status: "Idle",
          presence: "idle",
        },
      ],
    },
    {
      id: "makers",
      name: "Makers Club",
      host: "hall.makers.club",
      online: 12,
      channels: [
        { id: "general", name: "general", kind: "text", members: 30 },
        { id: "projects", name: "projects", kind: "text", members: 14 },
        { id: "night-shop", name: "night-shop", kind: "text", members: 9 },
      ],
      voice: [{ id: "shop", name: "shop", members: ["u-leslie"] }],
      dms: [
        {
          id: "dm-theresa",
          name: "Theresa Webb",
          user: "u-theresa",
          status: "Online",
          presence: "online",
        },
      ],
    },
    {
      id: "lumen",
      name: "Lumen",
      host: "team.lumen.dev",
      online: 3,
      channels: [
        { id: "build", name: "build", kind: "text", members: 4 },
        { id: "notes", name: "notes", kind: "text", members: 4 },
      ],
      voice: [],
      dms: [
        {
          id: "dm-wade",
          name: "Wade Warren",
          user: "u-wade",
          status: "Do not disturb",
          presence: "dnd",
        },
      ],
    },
  ];
}

function seedMessages() {
  return {
    "acme-studio:general": [
      msg("u-savannah", "Shipping the homepage Friday. Longer notes are in #design.", "8:40 AM"),
      msg("u-marvin", "I'll review after standup.", "8:44 AM"),
    ],
    "acme-studio:announcements": [
      msg(
        "u-kathryn",
        "Maintenance window Sunday 1:00 to 2:00am UTC. Calls will drop.",
        "Yesterday",
      ),
    ],
    "acme-studio:ops": [
      msg("u-kathryn", "Laptop refresh is ordered. Should land in two weeks.", "9:02 AM", {
        day: "Monday",
      }),
      msg("u-jacob", "Moved the nightly job to 2am so it stops fighting the build.", "9:20 AM", {
        day: "Monday",
      }),
      msg("me", "Same backup target, or the new bucket?", "9:24 AM", { day: "Monday" }),
      msg("u-jacob", "Same target. Nothing else changes.", "9:26 AM", { day: "Monday" }),
      msg("u-ludmil", "Reminder: audit week starts Monday. Keep the runbooks current.", "4:10 PM", {
        day: "Yesterday",
      }),
      msg(
        "u-savannah",
        "Runbooks are in the usual doc. I added the restore drill this morning.",
        "4:18 PM",
        { day: "Yesterday" },
      ),
      msg("me", "Added a note about the separate key store while I was in there.", "4:22 PM", {
        day: "Yesterday",
      }),
      msg("u-ludmil", "Before the audit: where does our chat actually live now?", "9:12 AM"),
      msg(
        "me",
        "On the box in the server closet. Messages sit in our Postgres, files in our MinIO, encrypted with our key.",
        "9:14 AM",
        { reactions: [{ emoji: "👍", count: 3, mine: false }] },
      ),
      msg("u-kathryn", "And if the box dies?", "9:15 AM"),
      msg(
        "u-jacob",
        "Nightly snapshots, copied off-machine. The key is stored separately. Without it, a backup can't be read.",
        "9:17 AM",
        {
          reactions: [
            { emoji: "🔑", count: 4, mine: true },
            { emoji: "👍", count: 2, mine: false },
          ],
          replies: [
            msg("u-kathryn", "Who else holds that key?", "9:18 AM"),
            msg(
              "me",
              "Two of us. It's in the password manager, not next to the backups.",
              "9:19 AM",
            ),
            msg("u-ludmil", "I'll add that to the audit notes.", "9:21 AM"),
          ],
        },
      ),
    ],
    "acme-studio:design": [
      msg(
        "u-kathryn",
        "The workspace rail should stay dark in both themes. It's the same object everywhere.",
        "9:02 AM",
      ),
      msg("u-jacob", "Agreed. Selection is the ember ring, nothing else.", "9:06 AM"),
    ],
    "acme-studio:random": [msg("u-wade", "Anyone bringing cake on Friday?", "Yesterday")],
    "acme-studio:dm-jacob": [
      msg("u-jacob", "Want the backup checksum from last night?", "9:28 AM"),
    ],
    "acme-studio:dm-savannah": [msg("u-savannah", "I'll be idle after 4.", "8:10 AM")],
    "makers:general": [
      msg(
        "u-theresa",
        "Doors at 7. The sign-in here is the club account, not your job.",
        "6:12 PM",
      ),
      msg("u-leslie", "I'll be at the front table.", "6:20 PM"),
    ],
    "makers:projects": [
      msg(
        "u-leslie",
        "The kiln shelf cracked again. Photos in the thread once I take them.",
        "5:02 PM",
      ),
    ],
    "makers:night-shop": [msg("u-theresa", "Laser cutter is free after 8.", "4:40 PM")],
    "makers:dm-theresa": [msg("u-theresa", "Save me a seat if you get there first.", "5:55 PM")],
    "lumen:build": [
      msg("u-marvin", "Preview deploy is up. Same app, this server's URL.", "11:16 AM"),
    ],
    "lumen:notes": [msg("u-wade", "API tokens stay out of this channel.", "11:02 AM")],
    "lumen:dm-wade": [
      msg("u-wade", "Ping me on the build channel, not here. I'm heads down.", "10:48 AM"),
    ],
  };
}

function msg(user, text, time, extra = {}) {
  return {
    id: messageId(),
    user,
    text,
    time,
    day: extra.day ?? "Today",
    reactions: extra.reactions ?? [],
    replies: extra.replies ?? [],
  };
}

function icon(root, name) {
  const source = root.querySelector(`[data-icon="${name}"] svg`);
  return source ? source.cloneNode(true) : document.createElement("span");
}

function avatar(root, seed, server = false) {
  const source = root.querySelector(
    `[data-avatar="${seed}"] .avatar${server ? ".avatar-server" : ":not(.avatar-server)"}`,
  );
  if (!source) {
    const fallback = document.createElement("span");
    fallback.className = server ? "avatar avatar-server" : "avatar";
    return fallback;
  }
  return source.cloneNode(true);
}

export function mountDemo(root) {
  const workspaces = createWorkspaces();
  const messages = seedMessages();
  const state = {
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
  let replyTimer = 0;

  const list = root.querySelector("[data-demo-list]");
  const workspaceSlot = root.querySelector("[data-demo-workspace]");
  const header = root.querySelector("[data-demo-header]");
  const transcript = root.querySelector("[data-demo-messages]");
  const composer = root.querySelector("[data-demo-composer]");
  const input = root.querySelector("[data-demo-input]");
  const send = root.querySelector("[data-demo-send]");
  const thread = root.querySelector("[data-demo-thread]");
  const status = root.querySelector("[data-demo-status]");
  const search = root.querySelector("[data-demo-search]");
  const fileInput = root.querySelector("[data-demo-file-input]");
  const wsPop = root.querySelector("[data-demo-ws-pop]");
  const jump = root.querySelector("[data-demo-jump]");

  const workspace = () => workspaces.find((item) => item.id === state.workspaceId);
  const currentKey = () => `${state.workspaceId}:${state.channelId}`;

  function currentChannel() {
    const ws = workspace();
    if (state.pane === "dm") return ws.dms.find((item) => item.id === state.channelId);
    if (state.pane === "voice") return ws.voice.find((item) => item.id === state.channelId);
    return ws.channels.find((item) => item.id === state.channelId);
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function updateJump() {
    if (!jump) return;
    const gap = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const hasOverflow = transcript.scrollHeight > transcript.clientHeight + 4;
    jump.hidden = !hasOverflow || gap < 48;
  }

  function openConversation(pane, id) {
    state.pane = pane;
    state.channelId = id;
    state.threadId = null;
    state.pickerId = null;
    state.forceBottom = true;
    const channel = currentChannel();
    if (channel && "unread" in channel) channel.unread = 0;
    if (channel && "dot" in channel) channel.dot = false;
    root.classList.remove("is-nav-open");
    render();
    input?.focus();
  }

  function pushMessage(targetKey, entry, parentId) {
    const bucket = messages[targetKey] ?? [];
    messages[targetKey] = bucket;
    if (parentId) {
      const parent = bucket.find((item) => item.id === parentId);
      if (parent) parent.replies.push(entry);
      return;
    }
    bucket.push(entry);
  }

  function scheduleReply(targetKey, channelId, text, workspaceId, parentId) {
    window.clearTimeout(replyTimer);
    state.typingKey = targetKey;
    render();
    replyTimer = window.setTimeout(() => {
      const reply = replyFor(workspaceId, channelId, text, state.replyStep);
      state.replyStep += 1;
      const entry = msg(reply.user, reply.text, clock());
      entry.fresh = true;
      pushMessage(targetKey, entry, parentId);
      if (!parentId && currentKey() !== targetKey) {
        const [wsId, id] = targetKey.split(":");
        const ws = workspaces.find((item) => item.id === wsId);
        const channel = ws?.channels.find((item) => item.id === id);
        if (channel) channel.unread = (channel.unread ?? 0) + 1;
      }
      state.typingKey = null;
      render();
      setStatus(`${PEOPLE[reply.user]?.name ?? "Someone"} replied.`);
    }, 850);
  }

  function sendCurrent() {
    const text = input.value.trim();
    const channel = currentChannel();
    if (!text || !channel || channel.post === false || state.pane === "voice") return;
    const entry = msg("me", text, clock());
    entry.fresh = true;
    const targetKey = currentKey();
    const parentId = state.threadId;
    pushMessage(targetKey, entry, parentId);
    input.value = "";
    state.forceBottom = true;
    syncSend();
    setStatus("Sent.");
    render();
    scheduleReply(targetKey, state.channelId, text, state.workspaceId, parentId);
  }

  function toggleReaction(message, emoji) {
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
    state.pickerId = null;
    render();
  }

  function renderWorkspace() {
    const ws = workspace();
    workspaceSlot.replaceChildren();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ws-header";
    button.setAttribute("aria-expanded", String(!wsPop.hidden));
    button.setAttribute("aria-haspopup", "menu");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = ws.name;
    const online = document.createElement("small");
    const dot = document.createElement("i");
    dot.className = "presence";
    online.append(dot, document.createTextNode(`${ws.online} online`));
    copy.append(title, online);
    button.append(avatar(root, ws.id, true), copy, icon(root, "chevron-down"));
    button.addEventListener("click", () => {
      wsPop.hidden = !wsPop.hidden;
      button.setAttribute("aria-expanded", String(!wsPop.hidden));
    });
    workspaceSlot.append(button);
  }

  function renderSwitchMenu() {
    wsPop.replaceChildren();
    for (const ws of workspaces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = ws.id === state.workspaceId ? "is-current" : "";
      button.setAttribute("role", "menuitem");
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = ws.name;
      const host = document.createElement("small");
      host.textContent = ws.host;
      label.append(title, host);
      button.append(avatar(root, ws.id, true), label);
      button.addEventListener("click", () => {
        state.workspaceId = ws.id;
        state.pane = "channel";
        state.channelId = ws.channels[0].id;
        state.threadId = null;
        state.pickerId = null;
        state.forceBottom = true;
        wsPop.hidden = true;
        if (search) search.value = "";
        setStatus(`${ws.name}. Separate account, separate server.`);
        render();
      });
      wsPop.append(button);
    }
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

  function renderList() {
    const ws = workspace();
    const query = (search?.value ?? "").trim().toLowerCase();
    list.replaceChildren();
    const addLabel = (text) => {
      const label = document.createElement("p");
      label.className = "app-label";
      label.append(icon(root, "chevron-down"), document.createTextNode(text));
      list.append(label);
    };
    addLabel("Channels");
    for (const channel of ws.channels) {
      if (query && !channel.name.includes(query)) continue;
      const name = document.createElement("span");
      name.textContent = channel.name;
      const bits = [icon(root, channel.kind === "announce" ? "announce" : "hash"), name];
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
      const button = rowButton(
        `app-row${state.pane === "channel" && state.channelId === channel.id ? " is-active" : ""}${channel.unread || channel.dot ? " is-unread" : ""}`,
        state.pane === "channel" && state.channelId === channel.id,
        () => openConversation("channel", channel.id),
        bits,
      );
      list.append(button);
    }
    if (ws.voice.length > 0) {
      addLabel("Voice");
      for (const channel of ws.voice) {
        if (query && !channel.name.includes(query)) continue;
        const name = document.createElement("span");
        name.textContent = channel.name;
        const people = document.createElement("span");
        people.className = "in-call";
        const members =
          state.call?.workspaceId === ws.id && state.call.channelId === channel.id
            ? [...channel.members, "me"]
            : channel.members;
        for (const member of members) people.append(avatar(root, member));
        list.append(
          rowButton(
            `app-row${state.pane === "voice" && state.channelId === channel.id ? " is-active" : ""}`,
            state.pane === "voice" && state.channelId === channel.id,
            () => openConversation("voice", channel.id),
            [icon(root, "volume"), name, people],
          ),
        );
      }
    }
    addLabel("Direct messages");
    for (const dm of ws.dms) {
      if (query && !dm.name.toLowerCase().includes(query)) continue;
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = dm.name;
      const presence = document.createElement("small");
      presence.textContent = dm.status;
      label.append(title, presence);
      list.append(
        rowButton(
          `app-dm${state.pane === "dm" && state.channelId === dm.id ? " is-active" : ""}`,
          state.pane === "dm" && state.channelId === dm.id,
          () => openConversation("dm", dm.id),
          [avatar(root, dm.user), label],
        ),
      );
    }
    if (query && list.querySelector("button") === null) {
      const empty = document.createElement("p");
      empty.className = "demo-empty";
      empty.textContent = "Nothing matches.";
      list.append(empty);
    }
  }

  function reactionButtons(message) {
    const wrap = document.createElement("p");
    wrap.className = "reactions";
    for (const reaction of message.reactions) {
      const button = document.createElement("button");
      button.type = "button";
      if (reaction.mine) button.className = "mine";
      button.textContent = `${reaction.emoji} ${reaction.count}`;
      button.setAttribute(
        "aria-label",
        `${reaction.emoji}, ${reaction.count}${reaction.mine ? ", yours" : ""}`,
      );
      button.addEventListener("click", () => toggleReaction(message, reaction.emoji));
      wrap.append(button);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-reaction";
    add.setAttribute("aria-label", "Add reaction");
    add.append(icon(root, "smile"));
    add.addEventListener("click", () => {
      state.pickerId = state.pickerId === message.id ? null : message.id;
      render();
    });
    wrap.append(add);
    if (state.pickerId === message.id) {
      const choices = document.createElement("span");
      choices.className = "react-choices";
      for (const [emoji, label] of REACTIONS) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = emoji;
        choice.setAttribute("aria-label", label);
        choice.addEventListener("click", () => toggleReaction(message, emoji));
        choices.append(choice);
      }
      wrap.append(choices);
    }
    return wrap;
  }

  function renderMessage(message, { threaded = false } = {}) {
    const person = PEOPLE[message.user] ?? { name: message.user, color: null };
    const row = document.createElement("div");
    row.className = message.fresh ? "msg is-new" : "msg";
    const face = avatar(root, message.user);
    let leading = face;
    if (person.color) {
      const ring = document.createElement("span");
      ring.className = "ring";
      ring.style.setProperty("--ring", person.color);
      ring.append(face);
      leading = ring;
    }
    const body = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "msg-meta";
    const name = document.createElement("strong");
    name.textContent = person.name;
    if (person.color) name.style.color = person.color;
    const time = document.createElement("time");
    time.textContent = message.time;
    meta.append(name, time);
    const text = document.createElement("p");
    text.textContent = message.text;
    body.append(meta, text, reactionButtons(message));
    if (!threaded && message.replies.length > 0) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "thread-link";
      const count = document.createElement("span");
      count.textContent = `${message.replies.length} ${message.replies.length === 1 ? "reply" : "replies"}`;
      link.append(icon(root, "thread"), count);
      link.addEventListener("click", () => {
        state.threadId = message.id;
        state.pickerId = null;
        render();
      });
      body.append(link);
    }
    row.append(leading, body);
    return row;
  }

  function renderConversation() {
    const channel = currentChannel();
    const ws = workspace();
    header.replaceChildren();
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "demo-nav";
    menu.setAttribute("aria-label", "Conversations");
    menu.append(icon(root, "menu"));
    menu.addEventListener("click", () => root.classList.toggle("is-nav-open"));
    const tile = document.createElement("span");
    tile.className = "tile";
    if (state.pane === "dm") tile.append(avatar(root, channel.user));
    else
      tile.append(
        icon(
          root,
          state.pane === "voice" ? "volume" : channel.kind === "announce" ? "announce" : "hash",
        ),
      );
    const title = document.createElement("span");
    title.className = "convo-title";
    const name = document.createElement("strong");
    name.textContent = channel.name;
    const sub = document.createElement("small");
    sub.textContent =
      state.pane === "dm"
        ? channel.status
        : state.pane === "voice"
          ? "Voice channel"
          : `${channel.members} members`;
    title.append(name, sub);
    const tools = document.createElement("span");
    tools.className = "app-tools";
    tools.append(icon(root, "pin"), icon(root, "search"), icon(root, "users"));
    header.append(menu, tile, title, tools);

    const gap = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const wasAtBottom = state.forceBottom || gap < 48;
    state.forceBottom = false;
    transcript.replaceChildren();
    if (state.pane === "voice") {
      const room = document.createElement("div");
      room.className = "voice-room";
      const heading = document.createElement("p");
      heading.textContent = `In #${channel.name} at ${ws.name}.`;
      room.append(heading);
      const members =
        state.call?.workspaceId === ws.id && state.call.channelId === channel.id
          ? [...channel.members, "me"]
          : [...channel.members];
      const faces = document.createElement("div");
      faces.className = "voice-people";
      for (const member of members) {
        const person = document.createElement("p");
        const who = document.createElement("span");
        who.textContent = PEOPLE[member]?.name ?? member;
        person.append(avatar(root, member), who);
        faces.append(person);
      }
      room.append(faces);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button button-primary";
      const joined = state.call?.workspaceId === ws.id && state.call.channelId === channel.id;
      action.textContent = joined ? "Leave" : "Join";
      action.addEventListener("click", () => {
        state.call = joined ? null : { workspaceId: ws.id, channelId: channel.id };
        setStatus(
          joined ? `Left ${channel.name}.` : `Joined ${channel.name}. No microphone in this demo.`,
        );
        render();
      });
      room.append(action);
      transcript.append(room);
    } else {
      let lastDay = null;
      for (const message of messages[currentKey()] ?? []) {
        if (message.day !== lastDay) {
          const day = document.createElement("p");
          day.className = "day";
          const dayLabel = document.createElement("span");
          dayLabel.textContent = message.day;
          day.append(dayLabel);
          transcript.append(day);
          lastDay = message.day;
        }
        transcript.append(renderMessage(message));
        message.fresh = false;
      }
      if (state.typingKey === currentKey()) {
        const typing = document.createElement("p");
        typing.className = "typing";
        typing.append(
          document.createElement("i"),
          document.createElement("i"),
          document.createElement("i"),
        );
        typing.append(document.createTextNode("Someone is typing"));
        transcript.append(typing);
      }
      const pin = () => {
        transcript.scrollTop = transcript.scrollHeight;
      };
      if (wasAtBottom) {
        pin();
        requestAnimationFrame(pin);
      } else {
        transcript.scrollTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight - gap);
      }
    }
    updateJump();

    const readOnly = state.pane === "voice" || channel.post === false;
    composer.hidden = state.pane === "voice";
    input.disabled = readOnly;
    if (state.pane === "dm") input.placeholder = `Message ${channel.name}`;
    else if (channel.post === false)
      input.placeholder = "You can't post in this announcement channel.";
    else input.placeholder = `Message #${channel.name}`;
    syncSend();
    renderThread();
  }

  function renderThread() {
    const parent = (messages[currentKey()] ?? []).find((item) => item.id === state.threadId);
    if (!parent) {
      thread.hidden = true;
      root.classList.remove("is-thread");
      return;
    }
    thread.hidden = false;
    root.classList.add("is-thread");
    thread.replaceChildren();
    const bar = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "Thread";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close thread");
    close.append(icon(root, "x"));
    close.addEventListener("click", () => {
      state.threadId = null;
      render();
    });
    bar.append(title, close);
    const stream = document.createElement("div");
    stream.className = "thread-stream";
    stream.append(renderMessage(parent, { threaded: true }));
    for (const reply of parent.replies) stream.append(renderMessage(reply, { threaded: true }));
    const note = document.createElement("p");
    note.className = "thread-hint";
    note.textContent = "Replies stay on this message.";
    thread.append(bar, stream, note);
  }

  function syncSend() {
    send.disabled = input.disabled || input.value.trim() === "";
  }

  function render() {
    renderWorkspace();
    renderSwitchMenu();
    renderList();
    renderConversation();
  }

  transcript.addEventListener("scroll", updateJump);
  jump?.addEventListener("click", () => {
    transcript.scrollTop = transcript.scrollHeight;
    updateJump();
  });
  search.addEventListener("input", () => renderList());
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      renderList();
      search.blur();
    }
  });
  input.addEventListener("input", syncSend);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    }
  });
  send.addEventListener("click", sendCurrent);
  root.querySelector("[data-demo-emoji]").addEventListener("click", () => {
    const bucket = messages[currentKey()] ?? [];
    const latest = state.threadId
      ? bucket.find((item) => item.id === state.threadId)
      : bucket[bucket.length - 1];
    if (!latest) return;
    state.pickerId = state.pickerId === latest.id ? null : latest.id;
    render();
  });
  root.querySelector("[data-demo-file]").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || input.disabled) return;
    const entry = msg(
      "me",
      `Attached ${file.name}. This demo keeps the name and drops the file.`,
      clock(),
    );
    entry.fresh = true;
    pushMessage(currentKey(), entry, Boolean(state.threadId));
    state.forceBottom = true;
    setStatus(`Attached ${file.name}.`);
    render();
  });
  composer.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  composer.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file || input.disabled) {
      setStatus("This channel doesn't take files.");
      return;
    }
    const entry = msg(
      "me",
      `Attached ${file.name}. This demo keeps the name and drops the file.`,
      clock(),
    );
    entry.fresh = true;
    pushMessage(currentKey(), entry, Boolean(state.threadId));
    render();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (event.key === "Escape") {
      const open = state.threadId !== null || state.pickerId !== null || !wsPop.hidden;
      wsPop.hidden = true;
      state.pickerId = null;
      state.threadId = null;
      if (open) render();
    }
  });
  document.addEventListener("click", (event) => {
    if (!workspaceSlot.contains(event.target) && !wsPop.contains(event.target)) wsPop.hidden = true;
  });
  const kbd = root.querySelector(".app-search kbd");
  if (kbd && !/Mac/i.test(navigator.platform ?? "")) kbd.textContent = "Ctrl K";

  for (const tool of root.querySelectorAll("[data-demo-tool]")) {
    tool.addEventListener("click", () => {
      if (input.disabled) return;
      const kind = tool.dataset.demoTool;
      if (kind === "code")
        input.value = `${input.value}${input.value.endsWith(" ") || input.value === "" ? "" : " "}\`code\``;
      else if (kind === "mention") input.value += "@";
      else if (kind === "channel") input.value += "#";
      else setStatus("Drop a file on the composer. This demo keeps the name only.");
      syncSend();
      input.focus();
    });
  }

  render();
}
