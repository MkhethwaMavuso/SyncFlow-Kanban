import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetBoardAnalyticsParams,
  GetBoardAnalyticsResponse,
  ListBoardActivityParams,
  ListBoardActivityQueryParams,
  ListBoardActivityResponse,
} from "@workspace/api-zod";
import { activityTable, db, tasksTable } from "@workspace/db";
import { requireAuth, userIdFromRequest } from "../lib/auth";
import { hasBoardAccess } from "../lib/boards";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/boards/:boardId/analytics", async (req, res): Promise<void> => {
  const params = GetBoardAnalyticsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const boardId = params.data.boardId;
  if (!(await hasBoardAccess(boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }

  const [counts] = await db
    .select({
      totalTasks: sql<number>`count(*)::int`,
      completedTasks: sql<number>`count(*) filter (where ${tasksTable.status} = 'Done')::int`,
      activeTasks: sql<number>`count(*) filter (where ${tasksTable.status} = 'In Progress')::int`,
      overdueTasks: sql<number>`count(*) filter (where ${tasksTable.dueDate} < now() and ${tasksTable.status} <> 'Done')::int`,
      low: sql<number>`count(*) filter (where ${tasksTable.priority} = 'Low')::int`,
      medium: sql<number>`count(*) filter (where ${tasksTable.priority} = 'Medium')::int`,
      high: sql<number>`count(*) filter (where ${tasksTable.priority} = 'High')::int`,
      urgent: sql<number>`count(*) filter (where ${tasksTable.priority} = 'Urgent')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.boardId, boardId));

  const firstWeek = new Date();
  firstWeek.setDate(firstWeek.getDate() - 41);
  firstWeek.setHours(0, 0, 0, 0);
  const completedActivity = await db
    .select({ createdAt: activityTable.createdAt })
    .from(activityTable)
    .where(
      and(
        eq(activityTable.boardId, boardId),
        eq(activityTable.action, "completed a task"),
        gte(activityTable.createdAt, firstWeek),
      ),
    )
    .orderBy(desc(activityTable.createdAt));

  const weeklyCompleted: Array<{ week: string; completed: number }> = [];
  const now = new Date();
  const weekStarts: Date[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - offset * 7);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStarts.push(weekStart);
  }
  for (let index = 0; index < weekStarts.length; index += 1) {
    const weekStart = weekStarts[index];
    const nextWeekStart = weekStarts[index + 1] ?? new Date(now.getTime() + 7 * 86400000);
    if (!weekStart) continue;
    const completed = completedActivity.filter(
      ({ createdAt }) => createdAt >= weekStart && createdAt < nextWeekStart,
    ).length;
    weeklyCompleted.push({
      week: weekStart.toLocaleDateString("en", { month: "short", day: "numeric" }),
      completed,
    });
  }

  const totalTasks = counts?.totalTasks ?? 0;
  const completedTasks = counts?.completedTasks ?? 0;
  res.json(
    GetBoardAnalyticsResponse.parse({
      totalTasks,
      completedTasks,
      activeTasks: counts?.activeTasks ?? 0,
      overdueTasks: counts?.overdueTasks ?? 0,
      completionRate:
        totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
      weeklyCompleted,
      priorityCounts: {
        Low: counts?.low ?? 0,
        Medium: counts?.medium ?? 0,
        High: counts?.high ?? 0,
        Urgent: counts?.urgent ?? 0,
      },
    }),
  );
});

router.get("/boards/:boardId/activity", async (req, res): Promise<void> => {
  const params = ListBoardActivityParams.safeParse(req.params);
  const query = ListBoardActivityQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: params.error?.message ?? query.error?.message });
    return;
  }
  const boardId = params.data.boardId;
  if (!(await hasBoardAccess(boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }

  const rows = await db
    .select()
    .from(activityTable)
    .where(eq(activityTable.boardId, boardId))
    .orderBy(desc(activityTable.createdAt))
    .limit(query.data.limit ?? 20);
  res.json(
    ListBoardActivityResponse.parse(
      rows.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    ),
  );
});

export default router;
