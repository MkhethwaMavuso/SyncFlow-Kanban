import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddBoardMemberBody,
  AddBoardMemberParams,
  AddBoardMemberResponse,
  CreateBoardBody,
  CreateBoardResponse,
  DeleteBoardParams,
  GetBoardParams,
  GetBoardResponse,
  ListBoardsResponse,
  UpdateBoardBody,
  UpdateBoardParams,
  UpdateBoardResponse,
} from "@workspace/api-zod";
import {
  boardMembersTable,
  boardsTable,
  db,
  usersTable,
} from "@workspace/db";
import { requireAuth, userIdFromRequest } from "../lib/auth";
import {
  boardDto,
  emitBoardUpdate,
  hasBoardAccess,
  isBoardOwner,
  recordActivity,
  userDisplayName,
} from "../lib/boards";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/boards", async (req, res): Promise<void> => {
  const userId = userIdFromRequest(req);
  const memberships = await db
    .select({ boardId: boardMembersTable.boardId })
    .from(boardMembersTable)
    .where(eq(boardMembersTable.userId, userId));
  const boards = await Promise.all(
    memberships.map(({ boardId }) => boardDto(boardId)),
  );
  res.json(ListBoardsResponse.parse(boards.filter((board) => board !== null)));
});

router.post("/boards", async (req, res): Promise<void> => {
  const parsed = CreateBoardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = userIdFromRequest(req);
  const [board] = await db.transaction(async (tx) => {
    const created = await tx
      .insert(boardsTable)
      .values({ title: parsed.data.title.trim(), ownerId: userId })
      .returning();
    const value = created[0];
    if (!value) return created;
    await tx.insert(boardMembersTable).values({
      boardId: value.id,
      userId,
      role: "owner",
    });
    return created;
  });
  if (!board) {
    res.status(500).json({ error: "Board could not be created." });
    return;
  }

  await recordActivity(
    board.id,
    userId,
    await userDisplayName(userId),
    "created the board",
    board.title,
  );
  const result = await boardDto(board.id);
  res.status(201).json(CreateBoardResponse.parse(result));
});

router.get("/boards/:boardId", async (req, res): Promise<void> => {
  const parsed = GetBoardParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const boardId = parsed.data.boardId;
  const userId = userIdFromRequest(req);
  const result = await boardDto(boardId);
  if (
    !result ||
    (!(await isBoardOwner(boardId, userId)) &&
      !(await hasBoardAccess(boardId, userId)))
  ) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  res.json(GetBoardResponse.parse(result));
});

router.patch("/boards/:boardId", async (req, res): Promise<void> => {
  const params = UpdateBoardParams.safeParse(req.params);
  const body = UpdateBoardBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const userId = userIdFromRequest(req);
  const boardId = params.data.boardId;
  if (!(await isBoardOwner(boardId, userId))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  if (!body.data.title) {
    res.status(400).json({ error: "Board title is required." });
    return;
  }
  await db
    .update(boardsTable)
    .set({ title: body.data.title.trim(), updatedAt: new Date() })
    .where(eq(boardsTable.id, boardId));
  const result = await boardDto(boardId);
  if (!result) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  await recordActivity(
    boardId,
    userId,
    await userDisplayName(userId),
    "renamed the board",
    result.title,
  );
  emitBoardUpdate(req, boardId, "board:updated");
  res.json(UpdateBoardResponse.parse(result));
});

router.delete("/boards/:boardId", async (req, res): Promise<void> => {
  const params = DeleteBoardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = userIdFromRequest(req);
  const boardId = params.data.boardId;
  if (!(await isBoardOwner(boardId, userId))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }
  await db.delete(boardsTable).where(
    and(eq(boardsTable.id, boardId), eq(boardsTable.ownerId, userId)),
  );
  emitBoardUpdate(req, boardId, "board:deleted");
  res.sendStatus(204);
});

router.post("/boards/:boardId/members", async (req, res): Promise<void> => {
  const params = AddBoardMemberParams.safeParse(req.params);
  const body = AddBoardMemberBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const boardId = params.data.boardId;
  const userId = userIdFromRequest(req);
  if (!(await isBoardOwner(boardId, userId))) {
    res.status(404).json({ error: "Board not found." });
    return;
  }

  const email = body.data.email.trim().toLowerCase();
  const [member] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      avatar: usersTable.avatar,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (!member) {
    res.status(404).json({ error: "No account was found for that email." });
    return;
  }

  const [existing] = await db
    .select({ id: boardMembersTable.id })
    .from(boardMembersTable)
    .where(
      and(
        eq(boardMembersTable.boardId, boardId),
        eq(boardMembersTable.userId, member.id),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(boardMembersTable).values({
      boardId,
      userId: member.id,
      role: "member",
    });
    await recordActivity(
      boardId,
      userId,
      await userDisplayName(userId),
      "added a teammate",
      member.name,
    );
    emitBoardUpdate(req, boardId, "member:added");
  }

  res.status(201).json(
    AddBoardMemberResponse.parse({ ...member, role: "member" }),
  );
});

export default router;
