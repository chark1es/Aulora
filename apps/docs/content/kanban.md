# Kanban

Kanban is an optional workspace addon for the web, desktop and mobile apps. It is off by default. Open **Workspace settings → Addons** and enable **Kanban** with the Manage workspace permission. The sidebar entry appears for members with View Kanban permission.

## Permissions

Grant Kanban permissions in **Workspace settings → Roles**. Existing roles keep their permissions when the addon is installed. New workspaces include View, Edit and Comment in the default member role; board management still requires an explicit grant.

| Permission | Allows |
| --- | --- |
| View Kanban | Read accessible boards, cards, comments, activity and attachments; browse GitHub with a personal connection |
| Edit Kanban | Create, edit, move, archive and restore cards; assign members; use work timers |
| Comment on Kanban | Add comments and edit or delete your own comments |
| Manage Kanban | Create and configure boards, change membership, archive and restore boards, moderate comments, delete boards and cards, and stop other members' timers |
| Attach files | Upload or remove attachments, together with Edit Kanban |
| Manage workspace | Enable or disable the addon |

Every operation also requires View Kanban. Workspace owners and administrators have all permissions. A private board limits access to selected current workspace members and users with Manage Kanban. Board managers can access every private board. Being assigned to a card does not grant board access. Banned users cannot read boards, and timed-out members cannot edit or comment. File downloads recheck current access, including URLs issued before membership was revoked.

## Boards and cards

Create a board from the board switcher at the top of Kanban: open it and choose **New board**. The same menu switches boards and shows archived boards. Choose a workspace board or a private board. Add members to a private board in **Board settings**. Configure up to 20 ordered columns, optional work-in-progress limits and up to 50 colored labels. Move cards out of a column before deleting it, including archived cards. Remove a label from all cards before deleting it.

Add cards within a column: choose **Add card**, type a title and press Enter. The composer stays open so you can add several in a row; press Escape to close it. Drag cards between or within columns: a dashed outline shows where the card will land, and a column that reached its limit turns red and refuses the card. Right-click a card, or use its **⋯** button, to move it up, down or to another column, assign it to yourself, start or stop its timer, copy its title, archive it or delete it. Right-clicking a column or the board background offers the matching column and board actions. WIP limits apply to active cards and are enforced by the server.

Open a card to edit its title, notes, assignees, labels, priority, start and due dates, estimate in minutes, checklist and GitHub links. Save explicitly. Concurrent edits are detected; reload the card before saving if someone else changed it. Attachments, comments and the Column selector save separately. Assignees and labels are chosen from a checklist; the people list can be searched. Search title or notes, and filter by assignee, label or priority. Each filter is a checklist, so you can tick several values at once; a card matches when it has any ticked value in every filter you use.

Each board supports up to 500 cards, including archived cards, and each workspace supports up to 200 boards. A card supports 100 checklist items, 20 attachments and 20 GitHub links. Existing upload size limits also apply.

Archive cards or boards to retain their content. Use **Show archived cards** in the board's **⋯** menu, or **Show archived boards** in the board switcher, to restore them. Archived boards are read-only, and archived cards cannot be edited or commented on until restored. The Activity section of a card shows the latest 50 events; comments can load older pages. Board managers can also permanently delete cards or entire boards after a confirmation. Deletion removes comments, activity and files that are no longer used.

## Work timers

Start or stop the timer inside a card, or from the card's right-click menu, to track elapsed work time. One timer can run on a card, and each person can run one timer at a time. Only the timer's owner or a board manager can stop it. Timers continue across reloads and browser sessions until stopped; they measure elapsed time, not keyboard or mouse activity.

Archiving a card or board stops its timers. Removing members from a private board stops their timers. Disabling Kanban stops all running timers and keeps board data for when it is enabled again.

## GitHub

Open GitHub from the board toolbar or **Link from GitHub** inside a card. Connect a personal access token. Prefer a fine-grained token limited to selected repositories with read access to metadata, issues and pull requests. See [GitHub's token permission documentation](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

Tokens are encrypted at rest, belong to individual users and never return to a client. Repository results use the caller's GitHub access. Browse repositories, or enter an owner/repository name to view open, closed or all issues and pull requests. Use Next/Previous to page through results. Links open the original GitHub item. Link from a card to add a reference, or link from the board toolbar to create a linked card in its first column.

Linking a title or URL shares that information with everyone who can read the board. GitHub itself continues to enforce access to the linked resource. Aulora's integration is read-only; it does not change GitHub issues, pull requests or repositories, and links do not automatically change card status. Disconnect to revoke Aulora's stored token, and revoke the token on GitHub if needed.

## Docker updates

Kanban uses the existing Convex backend and encrypted file storage. It needs no additional service or environment secret. Rebuild both the web and setup images, deploy the backend functions, then replace the web container:

```sh
docker compose build web setup
docker compose run --rm setup
docker compose up -d --no-deps web
```

Enabling the addon is a workspace setting, not a Docker environment variable. A redeploy preserves it and does not grant new permissions to existing roles.

## On iOS and Android

Boards open from the **Boards** tab, which appears once the addon is on and you have View Kanban permission. Swipe sideways to move between columns, or tap a column name above the board to jump to it. Tap a card to open it; long-press it, or tap its **⋯** button, for the same actions a right-click offers on the web, including **Move to** another column. The filter chips open checklists, and the card's properties open pickers for people, labels, priority and dates. Cards are moved from the actions list rather than by dragging. GitHub links are pasted in, and the GitHub browser is available on the web only.
