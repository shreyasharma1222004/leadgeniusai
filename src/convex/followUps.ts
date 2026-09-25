import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/** All follow-ups in the workspace with their lead attached. */
export const listForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("followUps")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .collect();
    const withLeads = await Promise.all(
      rows.map(async (row) => {
        const lead = await ctx.db.get(row.leadId);
        return { ...row, lead };
      }),
    );
    return withLeads
      .filter((r): r is typeof r & { lead: NonNullable<typeof r.lead> } => Boolean(r.lead))
      .sort((a, b) => a.dueAt - b.dueAt);
  },
});

/** Counts used by the Tasks page header chips. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { overdue: 0, dueToday: 0, upcoming: 0, done: 0 };
    }
    const rows = await ctx.db
      .query("followUps")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    let overdue = 0;
    let dueToday = 0;
    let upcoming = 0;
    let done = 0;
    for (const row of rows) {
      if (row.status === "done") {
        done++;
      } else if (row.status === "pending") {
        if (row.dueAt < now) overdue++;
        else if (row.dueAt <= endOfDay.getTime()) dueToday++;
        else upcoming++;
      }
    }
    return { overdue, dueToday, upcoming, done };
  },
});
