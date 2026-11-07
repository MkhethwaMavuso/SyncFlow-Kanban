import { and, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import type { Server } from "socket.io";
import { db } from "@workspace/db";
import {
  boardMembersTable,
  boardsTable,
  commentsTable,
  tasksTable,
  usersTable,
} from "@workspace/db";

export async function hasBoardAccess(
  boardId: number,
  userId: number,
): Promise<boolean> {
  const [membership] = await db
    .select({ id: boardMembersTable.id })
    .from(boardMembersTable)
    .where(
      and(
        eq(boardMembersTable.boardId, boardId),
        eq(boardMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function isBoardOwner(
  boardId: number,
  userId: number,
): Promise<boolean> {
  const [board] = await db
    .select({ id: boardsTable.id })
    .from(boardsTable)
    .where(and(eq(boardsTable.id, boardId), eq(boardsTable.ownerId, userId)))
    .limit(1);
  return Boolean(board);
}

export async function userDisplayName(userId: number): Promise<string> {
  const [user] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.name ?? "A teammate";
}

export async function boardMembers(boardId: number) {
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      avatar: usersTable.avatar,
      role: boardMembersTable.role,
    })
    .from(boardMembersTable)
    .innerJoin(usersTable, eq(boardMembersTable.userId, usersTable.id))
    .where(eq(boardMembersTable.boardId, boardId))
    .orderBy(usersTable.name);

  return rows;
}

export async function boardDto(boardId: number) {
  const [board] = await db
    .select()
    .from(boardsTable)
    .where(eq(boardsTable.id, boardId))
    .limit(1);
  if (!board) return null;

  const [counts] = await db
    .select({
      taskCount: sql<number>`count(${tasksTable.id})::int`,
      completedCount: sql<number>`count(*) filter (where ${tasksTable.status} = 'Done')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.boardId, boardId));

  const members = await boardMembers(boardId);
  return {
    id: board.id,
    title: board.title,
    ownerId: board.ownerId,
    members,
    taskCount: counts?.taskCount ?? 0,
    completedCount: counts?.completedCount ?? 0,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}

export async function memberIsOnBoard(
  boardId: number,
  userId: number | null | undefined,
): Promise<boolean> {
  if (userId == null) return false;
  return hasBoardAccess(boardId, userId);
}

export async function recordActivity(
  boardId: number,
  actorId: number | null,
  actorName: string,
  action: string,
  target: string,
  taskId: number | null = null,
): Promise<void> {
  const { activityTable } = await import("@workspace/db");
  await db.insert(activityTable).values({
    boardId,
    actorId,
    actorName,
    action,
    target,
    taskId,
  });
}

export function emitBoardUpdate(
  req: Request,
  boardId: number,
  kind: string,
  taskId?: number,
): void {
  const io = req.app.get("io") as Server | undefined;
  io?.to(`board:${boardId}`).emit("board:update", {
    boardId,
    kind,
    ...(taskId == null ? {} : { taskId }),
    changedAt: new Date().toISOString(),
  });
}

export async function taskCommentCount(taskId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentsTable)
    .where(eq(commentsTable.taskId, taskId));
  return row?.count ?? 0;
}
