import { hasPermission, Permission } from "@aulora/core";
import { query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./lib/permissions";

/**
 * Lists channels the caller can see. Channels lacking `ViewChannel` after
 * category and channel overrides are filtered out entirely.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const context = await loadPermissionContext(ctx, userId);
    const channels = await ctx.db.query("channels").collect();

    const visible = [];
    for (const channel of channels) {
      const categoryOverrides = await categoryOverridesFor(ctx, channel);
      const permissions = channelPermissions(context, channel, categoryOverrides);
      if (!hasPermission(permissions, Permission.ViewChannel)) {
        continue;
      }
      visible.push({
        id: channel._id,
        kind: channel.kind,
        categoryId: channel.categoryId ?? null,
        nameCiphertext: channel.nameCiphertext ?? null,
        topicCiphertext: channel.topicCiphertext ?? null,
        archived: channel.archived,
      });
    }
    return visible;
  },
});
