import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateSprintBody,
  CreateSprintParams,
  CreateSprintResponse,
  ListSprintsParams,
  ListSprintsResponse,
  UpdateSprintBody,
  UpdateSprintParams,
  UpdateSprintResponse,
} from "@workspace/api-zod";
import { db, sprintsTable, tasksTable } from "@workspace/db";
import { requireAuth, userIdFromRequest } from "../lib/auth";
import {
  emitBoardUpdate,
  hasBoardAccess,
  recordActivity,
  userDisplayName,
} from "../lib/boards";

const router: IRouter = Router();
router.use(requireAuth);

async function sprintDtos(boardId: number) {
  const rows = await db
    .select({
      id: sprintsTable.id,
      boardId: sprintsTable.boardId,
      name: sprintsTable.name,
      startDate: sprintsTable.startDate,
      endDate: sprintsTable.endDate,
      status: sprintsTable.status,
      goal: sprintsTable.goal,
      taskCount: sql<number>`count(${tasksTable.id})::int`,
      completedCount: sql<number>`count(*) filter (where ${tasksTable.status} = 'Done')::int`,
    })
    .from(sprintsTable)
    .leftJoin(tasksTable, eq(tasksTable.sprintId, sprintsTable.id))
    .where(eq(sprintsTable.boardId, boardId))
    .groupBy(sprintsTable.id)
    .orderBy(desc(sprintsTable.startDate), asc(sprintsTable.id));
  return rows;
}

async function sprintForAccess(sprintId: number) {
  const [sprint] = await db
    .select()
    .from(sprintsTable)
    .where(eq(sprintsTable.id, sprintId))
    .limit(1);
  return sprint ?? null;
}

router.get("/boards/:boardId/sprints", async (req, res): Promise<void> => {
  const params = ListSprintsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const boardId = params.data.boardId;
  if (!(await hasBoardAccess(boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  res.json(ListSprintsResponse.parse(await sprintDtos(boardId)));
});

router.post("/boards/:boardId/sprints", async (req, res): Promise<void> => {
  const params = CreateSprintParams.safeParse(req.params);
  const body = CreateSprintBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const boardId = params.data.boardId;
  const userId = userIdFromRequest(req);
  if (!(await hasBoardAccess(boardId, userId))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  const startDate = body.data.startDate.toISOString().slice(0, 10);
  const endDate = body.data.endDate.toISOString().slice(0, 10);
  if (endDate < startDate) {
    res.status(400).json({ error: "Sprint end date must be on or after its start date." });
    return;
  }
  const [sprint] = await db
    .insert(sprintsTable)
    .values({
      boardId,
      name: body.data.name.trim(),
      startDate,
      endDate,
      goal: body.data.goal?.trim() || null,
    })
    .returning();
  if (!sprint) {
    res.status(500).json({ error: "Sprint could not be created." });
    return;
  }
  await recordActivity(
    boardId,
    userId,
    await userDisplayName(userId),
    "planned a sprint",
    sprint.name,
  );
  emitBoardUpdate(req, boardId, "sprint:created");
  const result = (await sprintDtos(boardId)).find((entry) => entry.id === sprint.id);
  res.status(201).json(CreateSprintResponse.parse(result));
});

router.patch("/sprints/:sprintId", async (req, res): Promise<void> => {
  const params = UpdateSprintParams.safeParse(req.params);
  const body = UpdateSprintBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const sprint = await sprintForAccess(params.data.sprintId);
  const userId = userIdFromRequest(req);
  if (!sprint || !(await hasBoardAccess(sprint.boardId, userId))) {
    res.status(404).json({ error: "Sprint not found." });
    return;
  }

  const nextStart =
    body.data.startDate?.toISOString().slice(0, 10) ?? sprint.startDate;
  const nextEnd = body.data.endDate?.toISOString().slice(0, 10) ?? sprint.endDate;
  if (nextEnd < nextStart) {
    res.status(400).json({ error: "Sprint end date must be on or after its start date." });
    return;
  }
  if (body.data.status === "Active") {
    const [activeSprint] = await db
      .select({ id: sprintsTable.id })
      .from(sprintsTable)
      .where(
        and(
          eq(sprintsTable.boardId, sprint.boardId),
          eq(sprintsTable.status, "Active"),
        ),
      )
      .limit(1);
    if (activeSprint && activeSprint.id !== sprint.id) {
      res.status(409).json({ error: "Complete the current sprint before activating another." });
      return;
    }
  }

  const changes: Partial<typeof sprintsTable.$inferInsert> = {};
  if (body.data.name !== undefined) changes.name = body.data.name.trim();
  if (body.data.startDate !== undefined) changes.startDate = nextStart;
  if (body.data.endDate !== undefined) changes.endDate = nextEnd;
  if (body.data.status !== undefined) changes.status = body.data.status;
  if (body.data.goal !== undefined) changes.goal = body.data.goal?.trim() || null;
  await db
    .update(sprintsTable)
    .set(changes)
    .where(eq(sprintsTable.id, sprint.id));

  await recordActivity(
    sprint.boardId,
    userId,
    await userDisplayName(userId),
    "updated a sprint",
    body.data.name?.trim() ?? sprint.name,
  );
  emitBoardUpdate(req, sprint.boardId, "sprint:updated");
  const result = (await sprintDtos(sprint.boardId)).find((entry) => entry.id === sprint.id);
  res.json(UpdateSprintResponse.parse(result));
});

export default router;
