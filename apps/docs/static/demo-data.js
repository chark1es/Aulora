// Static data and reply logic for the in-page Aulora demo. Kept apart from the
// view and the event wiring so each module stays small and easy to read.

const PEOPLE = new Map([
  ["me", { name: "You", color: null }],
  ["u-ludmil", { name: "Ludmil Popov", color: null }],
  ["u-kathryn", { name: "Kathryn Murphy", color: "#7c5cff" }],
  ["u-jacob", { name: "Jacob Jones", color: "#0e9f8e" }],
  ["u-savannah", { name: "Savannah Nguyen", color: null }],
  ["u-theresa", { name: "Theresa Webb", color: null }],
  ["u-leslie", { name: "Leslie Alexander", color: null }],
  ["u-marvin", { name: "Marvin McKinney", color: null }],
  ["u-wade", { name: "Wade Warren", color: null }],
]);

export function person(id) {
  return PEOPLE.get(id) ?? { name: id, color: null };
}

export const REACTIONS = [
  ["👍", "Thumbs up"],
  ["🔑", "Key"],
  ["👀", "Eyes"],
];

let nextMessageId = 1;

export function clock(date = new Date()) {
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

export function createWorkspaces() {
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

export function msg(user, text, time, extra = {}) {
  nextMessageId += 1;
  return {
    id: `m${nextMessageId}`,
    user,
    text,
    time,
    day: extra.day ?? "Today",
    reactions: extra.reactions ?? [],
    replies: extra.replies ?? [],
  };
}

function seedEntries() {
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

export function seedMessages() {
  return new Map(Object.entries(seedEntries()));
}
