import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateTaskBody,
  CreateTaskCommentBody,
  CreateTaskCommentParams,
  CreateTaskCommentResponse,
  CreateTaskParams,
  CreateTaskResponse,
  DeleteTaskParams,
  GetTaskParams,
  GetTaskResponse,
  ListTaskCommentsParams,
  ListTaskCommentsResponse,
  ListTasksParams,
  ListTasksQueryParams,
  ListTasksResponse,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import {
  boardMembersTable,
  commentsTable,
  db,
  tasksTable,
  usersTable,
} from "@workspace/db";
import type { Task } from "@workspace/db";
import { requireAuth, userIdFromRequest } from "../lib/auth";
import {
  emitBoardUpdate,
  hasBoardAccess,
  recordActivity,
  userDisplayName,
} from "../lib/boards";

const router: IRouter = Router();
router.use(requireAuth);

type TaskPatch = Partial<{
  title: string;
  description: string | null;
  priority: Task["priority"];
  assigneeId: number | null;
  dueDate: Date | null;
  sprintId: number | null;
}>;

async function taskDto(taskId: number) {
  const [task] = await db
    .select({
      id: tasksTable.id,
      boardId: tasksTable.boardId,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      priority: tasksTable.priority,
      assigneeId: tasksTable.assigneeId,
      assigneeName: usersTable.name,
      dueDate: tasksTable.dueDate,
      sprintId: tasksTable.sprintId,
      position: tasksTable.position,
      commentCount: sql<number>`count(${commentsTable.id})::int`,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .leftJoin(commentsTable, eq(tasksTable.id, commentsTable.taskId))
    .where(eq(tasksTable.id, taskId))
    .groupBy(tasksTable.id, usersTable.name)
    .limit(1);

  if (!task) return null;
  return {
    ...task,
    dueDate: task.dueDate?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

async function taskForBoardAccess(taskId: number) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  return task ?? null;
}

async function validateRelations(
  boardId: number,
  assigneeId: number | null | undefined,
  sprintId: number | null | undefined,
): Promise<boolean> {
  if (assigneeId != null) {
    const [member] = await db
      .select({ id: boardMembersTable.id })
      .from(boardMembersTable)
      .where(
        and(
          eq(boardMembersTable.boardId, boardId),
          eq(boardMembersTable.userId, assigneeId),
        ),
      )
      .limit(1);
    if (!member) return false;
  }

  if (sprintId != null) {
    const { sprintsTable } = await import("@workspace/db");
    const [sprint] = await db
      .select({ id: sprintsTable.id })
      .from(sprintsTable)
      .where(
        and(
          eq(sprintsTable.id, sprintId),
          eq(sprintsTable.boardId, boardId),
        ),
      )
      .limit(1);
    if (!sprint) return false;
  }
  return true;
}

async function reorderTask(
  boardId: number,
  taskId: number,
  requestedStatus: Task["status"],
  requestedPosition: number | undefined,
  patch: TaskPatch,
): Promise<Task | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.boardId, boardId)))
      .limit(1);
    if (!current) return null;

    const sourceTasks =
      requestedStatus === current.status
        ? []
        : await tx
            .select({ id: tasksTable.id })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.boardId, boardId),
                eq(tasksTable.status, current.status),
              ),
            )
            .orderBy(asc(tasksTable.position), asc(tasksTable.id));

    const destinationTasks = await tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.boardId, boardId),
          eq(tasksTable.status, requestedStatus),
        ),
      )
      .orderBy(asc(tasksTable.position), asc(tasksTable.id));

    const destinationIds = destinationTasks
      .map((task) => task.id)
      .filter((id) => id !== taskId);
    const position =
      requestedPosition ??
      (requestedStatus === current.status ? current.position : destinationIds.length);
    destinationIds.splice(
      Math.max(0, Math.min(position, destinationIds.length)),
      0,
      taskId,
    );

    for (let index = 0; index < sourceTasks.length; index += 1) {
      const task = sourceTasks[index];
      if (task) {
        await tx
          .update(tasksTable)
          .set({ position: index })
          .where(eq(tasksTable.id, task.id));
      }
    }

    let updated: Task | null = null;
    for (let index = 0; index < destinationIds.length; index += 1) {
      const id = destinationIds[index];
      if (id == null) continue;
      const [row] = await tx
        .update(tasksTable)
        .set({
          ...(id === taskId ? patch : {}),
          status: requestedStatus,
          position: index,
          updatedAt: new Date(),
        })
        .where(eq(tasksTable.id, id))
        .returning();
      if (id === taskId) updated = row ?? null;
    }
    return updated;
  });
}

router.get("/boards/:boardId/tasks", async (req, res): Promise<void> => {
  const params = ListTasksParams.safeParse(req.params);
  const query = ListTasksQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: params.error?.message ?? query.error?.message });
    return;
  }
  const boardId = params.data.boardId;
  if (!(await hasBoardAccess(boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }

  const filters = [eq(tasksTable.boardId, boardId)];
  if (query.data.status) filters.push(eq(tasksTable.status, query.data.status));
  if (query.data.assigneeId != null) filters.push(eq(tasksTable.assigneeId, query.data.assigneeId));
  if (query.data.priority) filters.push(eq(tasksTable.priority, query.data.priority));
  if (query.data.sprintId != null) filters.push(eq(tasksTable.sprintId, query.data.sprintId));

  const rows = await db
    .select({
      id: tasksTable.id,
      boardId: tasksTable.boardId,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      priority: tasksTable.priority,
      assigneeId: tasksTable.assigneeId,
      assigneeName: usersTable.name,
      dueDate: tasksTable.dueDate,
      sprintId: tasksTable.sprintId,
      position: tasksTable.position,
      commentCount: sql<number>`count(${commentsTable.id})::int`,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .leftJoin(commentsTable, eq(tasksTable.id, commentsTable.taskId))
    .where(and(...filters))
    .groupBy(tasksTable.id, usersTable.name)
    .orderBy(asc(tasksTable.status), asc(tasksTable.position), asc(tasksTable.id));

  res.json(
    ListTasksResponse.parse(
      rows.map((task) => ({
        ...task,
        dueDate: task.dueDate?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      })),
    ),
  );
});

router.post("/boards/:boardId/tasks", async (req, res): Promise<void> => {
  const params = CreateTaskParams.safeParse(req.params);
  const body = CreateTaskBody.safeParse(req.body);
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
  if (!(await validateRelations(boardId, body.data.assigneeId, body.data.sprintId))) {
    res.status(400).json({ error: "Assignee and sprint must belong to this board." });
    return;
  }

  const status = body.data.status ?? "Backlog";
  const [lastPosition] = await db
    .select({ position: tasksTable.position })
    .from(tasksTable)
    .where(and(eq(tasksTable.boardId, boardId), eq(tasksTable.status, status)))
    .orderBy(desc(tasksTable.position))
    .limit(1);
  const [task] = await db
    .insert(tasksTable)
    .values({
      boardId,
      title: body.data.title.trim(),
      description: body.data.description ?? null,
      status,
      priority: body.data.priority ?? "Medium",
      assigneeId: body.data.assigneeId ?? null,
      dueDate: body.data.dueDate ?? null,
      sprintId: body.data.sprintId ?? null,
      position: (lastPosition?.position ?? -1) + 1,
      createdBy: userId,
    })
    .returning();
  if (!task) {
    res.status(500).json({ error: "Task could not be created." });
    return;
  }

  await recordActivity(boardId, userId, await userDisplayName(userId), "created a task", task.title, task.id);
  if (task.status === "Done") {
    await recordActivity(boardId, userId, await userDisplayName(userId), "completed a task", task.title, task.id);
  }
  emitBoardUpdate(req, boardId, "task:created", task.id);
  const result = await taskDto(task.id);
  res.status(201).json(CreateTaskResponse.parse(result));
});

router.get("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const task = await taskForBoardAccess(params.data.taskId);
  if (!task || !(await hasBoardAccess(task.boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json(GetTaskResponse.parse(await taskDto(task.id)));
});

router.patch("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const body = UpdateTaskBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const taskId = params.data.taskId;
  const current = await taskForBoardAccess(taskId);
  if (!current || !(await hasBoardAccess(current.boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const patch: TaskPatch = {};
  if (body.data.title !== undefined) patch.title = body.data.title.trim();
  if (body.data.description !== undefined) patch.description = body.data.description;
  if (body.data.priority !== undefined) patch.priority = body.data.priority;
  if (body.data.assigneeId !== undefined) patch.assigneeId = body.data.assigneeId;
  if (body.data.dueDate !== undefined) patch.dueDate = body.data.dueDate;
  if (body.data.sprintId !== undefined) patch.sprintId = body.data.sprintId;
  if (
    !(await validateRelations(
      current.boardId,
      patch.assigneeId ?? current.assigneeId,
      patch.sprintId ?? current.sprintId,
    ))
  ) {
    res.status(400).json({ error: "Assignee and sprint must belong to this board." });
    return;
  }

  const status = body.data.status ?? current.status;
  const task = await reorderTask(
    current.boardId,
    taskId,
    status,
    body.data.position,
    patch,
  );
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const userId = userIdFromRequest(req);
  const actorName = await userDisplayName(userId);
  const moved = current.status !== task.status;
  await recordActivity(
    task.boardId,
    userId,
    actorName,
    moved ? `moved a task to ${task.status}` : "updated a task",
    task.title,
    task.id,
  );
  if (current.status !== "Done" && task.status === "Done") {
    await recordActivity(task.boardId, userId, actorName, "completed a task", task.title, task.id);
  }
  emitBoardUpdate(req, task.boardId, moved ? "task:moved" : "task:updated", task.id);
  res.json(UpdateTaskResponse.parse(await taskDto(task.id)));
});

router.delete("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const task = await taskForBoardAccess(params.data.taskId);
  if (!task || !(await hasBoardAccess(task.boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  await recordActivity(
    task.boardId,
    userIdFromRequest(req),
    await userDisplayName(userIdFromRequest(req)),
    "deleted a task",
    task.title,
    task.id,
  );
  await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
  emitBoardUpdate(req, task.boardId, "task:deleted", task.id);
  res.sendStatus(204);
});

router.get("/tasks/:taskId/comments", async (req, res): Promise<void> => {
  const params = ListTaskCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const task = await taskForBoardAccess(params.data.taskId);
  if (!task || !(await hasBoardAccess(task.boardId, userIdFromRequest(req)))) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  const rows = await db
    .select({
      id: commentsTable.id,
      taskId: commentsTable.taskId,
      authorId: commentsTable.authorId,
      authorName: usersTable.name,
      body: commentsTable.body,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.taskId, task.id))
    .orderBy(asc(commentsTable.createdAt));
  res.json(
    ListTaskCommentsResponse.parse(
      rows.map((comment) => ({
        ...comment,
        createdAt: comment.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/tasks/:taskId/comments", async (req, res): Promise<void> => {
  const params = CreateTaskCommentParams.safeParse(req.params);
  const body = CreateTaskCommentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const task = await taskForBoardAccess(params.data.taskId);
  const userId = userIdFromRequest(req);
  if (!task || !(await hasBoardAccess(task.boardId, userId))) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  const [comment] = await db
    .insert(commentsTable)
    .values({ taskId: task.id, authorId: userId, body: body.data.body.trim() })
    .returning();
  if (!comment) {
    res.status(500).json({ error: "Comment could not be added." });
    return;
  }
  const authorName = await userDisplayName(userId);
  await recordActivity(task.boardId, userId, authorName, "commented on", task.title, task.id);
  emitBoardUpdate(req, task.boardId, "comment:created", task.id);
  res.status(201).json(
    CreateTaskCommentResponse.parse({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      authorName,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    }),
  );
});

export default router;
