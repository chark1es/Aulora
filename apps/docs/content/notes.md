# Notes

Notes is an optional workspace addon for the web, desktop and mobile apps. It is off by default. Open **Workspace settings → Addons** and enable **Notes** with the Manage workspace permission. The sidebar entry appears for members with View Notes permission.

## Permissions

Grant Notes permissions in **Workspace settings → Roles**. Existing roles keep their permissions when the addon is installed, so grant View Notes, Create Notes and Edit Notes explicitly before inviting members to use it. New workspaces include View, Create and Edit in the default member role; deleting and moderation still require an explicit grant.

| Permission | Allows |
| --- | --- |
| View Notes | Open the addon and read folders, notes, tags and history |
| Create Notes | Create notes and folders |
| Edit Notes | Edit any note, rename or move folders, and manage tags |
| Delete Notes | Delete notes, folders and tags |
| Manage Notes | Moderate any note and view the full workspace notes history |
| Manage workspace | Enable or disable the addon |

Every operation also requires View Notes. Workspace owners and administrators have all permissions. Banned users cannot read notes. Every mutation is re-checked on the server; the client copy of the permission logic only hides UI.

## Folders

Organize notes into a tree of folders. Create a folder from the sidebar and nest it under another folder to any depth. Rename or move a folder from its **⋯** menu; a folder cannot be moved inside itself or one of its descendants. The sidebar shows the tree, and selecting a folder lists the notes it contains. Root holds notes that are not filed in any folder.

A folder must be empty before you delete it. Remove or move its child folders and notes first, then confirm the delete. Archived notes still count as children until you delete or restore them. A workspace holds up to 500 folders and up to 2000 notes.

## Editor

Notes are written in Markdown. The editor pairs a text area with a formatting toolbar and a live preview, so you can write plain Markdown and toggle the preview to check the result. The toolbar inserts headings, bold, italic, code, lists, quotes, links and horizontal rules.

A note has a title of up to 200 characters and a body of up to 100,000 characters. Choose a folder and any tags from the editor, then save. Saving uses a revision guard: if someone else changed the note first, the save is rejected and you reload before trying again. Every note keeps its creating and last-editing member.

The preview renders headings, paragraphs, fenced code, ordered and unordered lists, blockquotes, horizontal rules, and inline bold, italic, code and links. Raw HTML is never rendered.

## Tags

Tags label notes across folders. Create a tag from the sidebar with a name of up to 32 characters and a color. Add or remove tags on any note in the editor, and select a tag in the sidebar to filter the note list. Rename or recolor a tag at any time; deleting a tag removes it from every note that used it. A workspace holds up to 200 tags.

## Search

Search runs in two places. As you type, the app filters the notes it has already loaded on your device, so results are instant and work offline. Submitting the query also asks the server, which searches within your permissions and returns matching notes with a short snippet.

The server search matches whole words and prefixes across note titles and bodies. It returns at most 30 results by default and never exposes a note you cannot read. Clearing the query restores the folder list.

## Activity history

Each note records its history. Open **History** from a note to see recent revisions newest first, up to 100 per note, with the oldest pruned as new ones are written. History covers creating, updating, renaming, moving, tagging, archiving, restoring and deleting a note.

Every entry names the member who made the change and shows the title and body as a line diff, with added and removed lines marked. Members with Manage Notes can view the full workspace notes history, including notes they cannot otherwise read.

## Archive and delete

Archive a note to keep its content while removing it from the active list. Show archived notes from the folder menu and restore them at any time. Archived notes stay searchable by members who can read them and keep their history.

Deleting a note is permanent. Delete removes the note and its revisions after a confirmation, and cannot be undone. On the server the note is removed immediately and its history is purged in the background.

## Docker updates

Notes uses the existing Convex backend and encrypted storage. It needs no additional service or environment secret. Rebuild both the web and setup images, deploy the backend functions, then replace the web container:

```sh
docker compose build web setup
docker compose run --rm setup
docker compose up -d --no-deps web
```

Enabling the addon is a workspace setting, not a Docker environment variable. A redeploy preserves it and does not grant new permissions to existing roles.

## On iOS and Android

Notes opens from the **Notes** tab, which appears once the addon is on and you have View Notes permission. The hub shows the folder tree and the note list; tap a note to open the editor, which has the Markdown text area and a preview toggle. Tags are picked from the note's tag field, and **History** opens the same per-note revisions with line diffs. Creating, editing and deleting follow the same permissions as the web and desktop apps.
