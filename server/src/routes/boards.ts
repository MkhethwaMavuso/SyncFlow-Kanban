import { Router } from "express";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { z } from "zod";
import { Board } from "../models/Board";
import { Column } from "../models/Column";
import { Sprint } from "../models/Sprint";
import { Task, taskPriorities } from "../models/Task";
import { User } from "../models/User";
import { authenticate, hasBoardManagerAccess, requireBoardMember } from "../middleware/auth";
import { boardState, createTask, deleteTask, moveTask } from "../services/tasks";
import { asyncRoute } from "../utils/errors";

const router = Router();
router.use(authenticate);
const objectId = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid ID");

router.get("/", asyncRoute(async (req, res) => {
  const boards = await Board.find({
    $or: [{ owner: req.user?.id }, { "members.user": req.user?.id }],
  }).select("title description owner updatedAt").sort({ updatedAt: -1 }).lean();
  res.json({ boards });
}));

router.post("/", asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(1).max(100) }).parse(req.body);
  const session = await mongoose.startSession();
  let boardId!: string;
  let columns: Awaited<ReturnType<typeof Column.insertMany>> = [];
  try {
    await session.withTransaction(async () => {
      const [board] = await Board.create(
        [{
          title: input.title,
          owner: req.user?.id,
          nextColumnOrder: 4,
          members: [{ user: req.user?.id, boardRole: "PRODUCT_MANAGER" }],
        }],
        { session },
      );
      columns = await Column.insertMany(
        ["To do", "In progress", "In review", "Done"].map((title, order) => ({
          title, boardId: board._id, order,
        })),
        { session },
      );
      boardId = board.id;
    });
  } finally {
    await session.endSession();
  }
  const board = await Board.findById(boardId);
  res.status(201).json({ board, columns });
}));

router.get("/:boardId", requireBoardMember, asyncRoute(async (req, res) => {
  const [board, state, members, sprints] = await Promise.all([
    Board.findById(req.boardId).populate("owner", "username"),
    boardState(req.boardId!),
    Board.findById(req.boardId).populate("members.user", "username email"),
    Sprint.find({ boardId: req.boardId }).sort({ startDate: -1 }).lean(),
  ]);
  res.json({ board, ...state, members: members?.members ?? [], sprints });
}));

router.post("/:boardId/columns", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  const input = z.object({ title: z.string().trim().min(1).max(60) }).parse(req.body);
  const updatedBoard = await Board.findByIdAndUpdate(
    req.boardId,
    { $inc: { nextColumnOrder: 1 } },
    { new: true },
  );
  if (!updatedBoard) {
    res.status(404).json({ message: "Board not found" });
    return;
  }
  const column = await Column.create({
    ...input,
    boardId: req.boardId,
    order: updatedBoard.nextColumnOrder - 1,
  });
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.status(201).json({ column });
}));

router.patch("/:boardId/columns/:columnId", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.columnId)) {
    res.status(400).json({ message: "Invalid column ID" });
    return;
  }
  const { title } = z.object({ title: z.string().trim().min(1).max(60) }).parse(req.body);
  const column = await Column.findOneAndUpdate(
    { _id: req.params.columnId, boardId: req.boardId },
    { $set: { title } },
    { new: true, runValidators: true },
  );
  if (!column) {
    res.status(404).json({ message: "Column not found" });
    return;
  }
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.json({ column });
}));

router.delete("/:boardId/columns/:columnId", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.columnId)) {
    res.status(400).json({ message: "Invalid column ID" });
    return;
  }
  const [column, taskCount] = await Promise.all([
    Column.findOne({ _id: req.params.columnId, boardId: req.boardId }),
    Task.countDocuments({ boardId: req.boardId, columnId: req.params.columnId }),
  ]);
  if (!column) {
    res.status(404).json({ message: "Column not found" });
    return;
  }
  if (taskCount > 0) {
    res.status(409).json({ message: "Move or delete its tasks before deleting this column" });
    return;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Board.updateOne(
        { _id: req.boardId },
        { $inc: { columnOrderVersion: 1 } },
        { session },
      );
      const target = await Column.findOne({ _id: req.params.columnId, boardId: req.boardId })
        .session(session);
      if (!target) throw Object.assign(new Error("Column not found"), { status: 404 });
      await Column.updateOne(
        { _id: target._id, boardId: req.boardId },
        { $inc: { orderingVersion: 1 } },
        { session },
      );
      if (await Task.countDocuments({ boardId: req.boardId, columnId: target._id }).session(session)) {
        throw Object.assign(
          new Error("Move or delete its tasks before deleting this column"),
          { status: 409 },
        );
      }
      const lastColumn = await Column.findOne({ boardId: req.boardId })
        .sort({ order: -1 })
        .session(session);
      await target.deleteOne({ session });
      const laterColumns = await Column.find({
        boardId: req.boardId,
        order: { $gt: target.order },
      }).sort({ order: 1 }).session(session);
      const temporaryBase = (lastColumn?.order ?? -1) + 1;
      if (laterColumns.length > 0) {
        await Column.bulkWrite(
          laterColumns.map((item, index) => ({
            updateOne: {
              filter: { _id: item._id },
              update: { $set: { order: temporaryBase + index } },
            },
          })),
          { session },
        );
        await Column.bulkWrite(
          laterColumns.map((item, index) => ({
            updateOne: { filter: { _id: item._id }, update: { $set: { order: target.order + index } } },
          })),
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.status(204).end();
}));

router.patch("/:boardId/columns", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  const { columnIds } = z.object({
    columnIds: z.array(objectId).min(1).max(50),
  }).parse(req.body);
  if (new Set(columnIds).size !== columnIds.length) {
    res.status(400).json({ message: "Column IDs must be unique" });
    return;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Board.updateOne(
        { _id: req.boardId },
        { $inc: { columnOrderVersion: 1 } },
        { session },
      );
      const currentColumns = await Column.find({ boardId: req.boardId }).select("_id").session(session);
      if (
        currentColumns.length !== columnIds.length ||
        currentColumns.some((column) => !columnIds.includes(column.id))
      ) {
        throw Object.assign(new Error("Provide every board column exactly once"), { status: 400 });
      }
      const lastColumn = await Column.findOne({ boardId: req.boardId })
        .sort({ order: -1 })
        .session(session);
      const temporaryBase = (lastColumn?.order ?? -1) + 1;
      await Column.bulkWrite(
        columnIds.map((id, order) => ({
          updateOne: {
            filter: { _id: id, boardId: req.boardId },
            update: { $set: { order: temporaryBase + order } },
          },
        })),
        { session },
      );
      await Column.bulkWrite(
        columnIds.map((id, order) => ({
          updateOne: { filter: { _id: id, boardId: req.boardId }, update: { $set: { order } } },
        })),
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  const state = await boardState(req.boardId!);
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", state);
  res.json(state);
}));

router.post("/:boardId/members", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  const input = z.object({
    email: z.string().email(),
    boardRole: z.enum(["PRODUCT_MANAGER", "SCRUM_MASTER", "DEVELOPER"]),
  }).parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user) {
    res.status(404).json({ message: "No account exists for that email" });
    return;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const currentBoard = await Board.findById(req.boardId).select("members").session(session);
      if (!currentBoard) throw Object.assign(new Error("Board not found"), { status: 404 });
      const existingMember = currentBoard.members.find((member) => member.user.toString() === user.id);
      if (existingMember) {
        await Board.updateOne(
          { _id: req.boardId, "members.user": user._id },
          { $set: { "members.$.boardRole": input.boardRole } },
          { session },
        );
      } else {
        await Board.updateOne(
          { _id: req.boardId, "members.user": { $ne: user._id } },
          { $push: { members: { user: user._id, boardRole: input.boardRole } } },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  const board = await Board.findById(req.boardId).populate("members.user", "username email");
  res.json({ members: board?.members ?? [] });
}));

router.delete("/:boardId/members/:memberId", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
    res.status(400).json({ message: "Invalid member ID" });
    return;
  }
  const board = await Board.findOne({ _id: req.boardId, owner: req.params.memberId }).select("_id");
  if (board) {
    res.status(400).json({ message: "The board owner cannot be removed" });
    return;
  }
  const result = await Board.updateOne(
    { _id: req.boardId, "members.user": req.params.memberId },
    { $pull: { members: { user: req.params.memberId } } },
  );
  if (result.modifiedCount === 0) {
    res.status(404).json({ message: "Board member not found" });
    return;
  }
  const io = req.app.get("io") as Server;
  const peers = await io.in(req.params.boardId).fetchSockets();
  for (const peer of peers) {
    if (peer.data.userId === req.params.memberId) await peer.leave(req.params.boardId);
  }
  const state = await boardState(req.boardId!);
  io.to(req.params.boardId).emit("board:state-updated", state);
  io.to(req.params.boardId).emit("board:presence", (await io.in(req.params.boardId).fetchSockets()).length);
  res.status(204).end();
}));

router.post("/:boardId/tasks", requireBoardMember, asyncRoute(async (req, res) => {
  const input = z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(3000).optional(),
    columnId: objectId,
    priority: z.enum(taskPriorities).optional(),
    storyPoints: z.number().min(0).max(100).optional(),
  }).parse(req.body);
  const task = await createTask(req.params.boardId, input.columnId, input);
  if (!task) throw new Error("Created task could not be loaded");
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.status(201).json({ task });
}));

router.patch("/:boardId/tasks/:taskId/move", requireBoardMember, asyncRoute(async (req, res) => {
  const input = z.object({
    columnId: objectId,
    index: z.number().int().min(0).max(10000),
  }).parse(req.body);
  if (!mongoose.Types.ObjectId.isValid(req.params.taskId)) {
    res.status(400).json({ message: "Invalid task ID" });
    return;
  }
  const state = await moveTask(req.params.boardId, req.params.taskId, input.columnId, input.index);
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", state);
  res.json(state);
}));

router.patch("/:boardId/tasks/:taskId", requireBoardMember, asyncRoute(async (req, res) => {
  const input = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(3000).optional(),
    columnId: objectId.optional(),
    priority: z.enum(taskPriorities).optional(),
    assignedTo: objectId.nullable().optional(),
    sprintId: objectId.nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    storyPoints: z.number().min(0).max(100).optional(),
  }).strict().parse(req.body);
  if (!mongoose.Types.ObjectId.isValid(req.params.taskId)) {
    res.status(400).json({ message: "Invalid task ID" });
    return;
  }
  if (Object.keys(input).length === 0) {
    res.status(400).json({ message: "At least one task field must be provided" });
    return;
  }
  if (input.assignedTo && !await Board.exists({
    _id: req.boardId,
    $or: [{ "members.user": input.assignedTo }, { owner: input.assignedTo }],
  })) {
    res.status(400).json({ message: "Assignee must be a board member" });
    return;
  }
  if (input.sprintId && !await Sprint.exists({ _id: input.sprintId, boardId: req.boardId })) {
    res.status(400).json({ message: "Sprint must belong to this board" });
    return;
  }
  const update: Record<string, unknown> = { ...input };
  delete update.columnId;
  if (input.dueDate) update.dueDate = new Date(input.dueDate);
  if (input.columnId) {
    const state = await moveTask(req.params.boardId, req.params.taskId, input.columnId, undefined, update);
    const task = state.tasks.find((item) => item._id.toString() === req.params.taskId);
    if (!task) throw new Error("Updated task could not be loaded");
    req.app.get("io").to(req.params.boardId).emit("board:state-updated", state);
    res.json({ task });
    return;
  }
  const task = await Task.findOneAndUpdate(
    { _id: req.params.taskId, boardId: req.boardId },
    { $set: update },
    { new: true, runValidators: true },
  ).populate("assignedTo", "username");
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.json({ task });
}));

router.delete("/:boardId/tasks/:taskId", requireBoardMember, asyncRoute(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.taskId)) {
    res.status(400).json({ message: "Invalid task ID" });
    return;
  }
  await deleteTask(req.params.boardId, req.params.taskId);
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.status(204).end();
}));

router.post("/:boardId/sprints", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  const input = z.object({
    title: z.string().trim().min(1).max(100),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  }).parse(req.body);
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    res.status(400).json({ message: "Sprint end date must be after its start date" });
    return;
  }
  const sprint = await Sprint.create({ ...input, boardId: req.boardId });
  res.status(201).json({ sprint });
}));

router.delete("/:boardId/sprints/:sprintId", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.sprintId)) {
    res.status(400).json({ message: "Invalid sprint ID" });
    return;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const sprint = await Sprint.findOneAndDelete(
        { _id: req.params.sprintId, boardId: req.boardId },
        { session },
      );
      if (!sprint) throw Object.assign(new Error("Sprint not found"), { status: 404 });
      await Task.updateMany(
        { sprintId: sprint._id, boardId: req.boardId },
        { $set: { sprintId: null } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.status(204).end();
}));

router.patch("/:boardId/sprints/:sprintId/status", requireBoardMember, asyncRoute(async (req, res) => {
  if (!await hasBoardManagerAccess(req.params.boardId, req.user!.id)) {
    res.status(403).json({ message: "Board manager role required" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.sprintId)) {
    res.status(400).json({ message: "Invalid sprint ID" });
    return;
  }
  const { status } = z.object({ status: z.enum(["PLANNING", "ACTIVE", "COMPLETED"]) }).parse(req.body);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const sprint = await Sprint.findOne({ _id: req.params.sprintId, boardId: req.boardId }).session(session);
      if (!sprint) throw Object.assign(new Error("Sprint not found"), { status: 404 });
      if (status === "ACTIVE") {
        await Sprint.updateMany(
          { boardId: req.boardId, status: "ACTIVE", _id: { $ne: req.params.sprintId } },
          { $set: { status: "COMPLETED" } },
          { session },
        );
      }
      sprint.status = status;
      await sprint.save({ session });
    });
  } finally {
    await session.endSession();
  }
  const sprint = await Sprint.findById(req.params.sprintId);
  req.app.get("io").to(req.params.boardId).emit("board:state-updated", await boardState(req.boardId!));
  res.json({ sprint });
}));

router.get("/:boardId/sprints/metrics", requireBoardMember, asyncRoute(async (req, res) => {
  const sprint = await Sprint.findOne({ boardId: req.boardId, status: "ACTIVE" });
  if (!sprint) {
    res.json({
      sprint: null,
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        completion: 0,
        velocity: 0,
        completedStoryPoints: 0,
        burndown: [],
      },
    });
    return;
  }
  const completedColumn = await Column.findOne({ boardId: req.boardId }).sort({ order: -1 }).select("_id");
  const [metrics] = await Task.aggregate([
    { $match: { boardId: new mongoose.Types.ObjectId(req.params.boardId), sprintId: sprint._id } },
    {
      $group: {
        _id: null,
        totalTasks: { $sum: 1 },
        totalStoryPoints: { $sum: { $ifNull: ["$storyPoints", 0] } },
        completedTasks: {
          $sum: { $cond: [{ $eq: ["$columnId", completedColumn?._id ?? null] }, 1, 0] },
        },
        completedStoryPoints: {
          $sum: { $cond: [{ $eq: ["$columnId", completedColumn?._id ?? null] }, "$storyPoints", 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalTasks: 1,
        completedTasks: 1,
        completedStoryPoints: 1,
        completion: {
          $cond: [
            { $gt: ["$totalTasks", 0] },
            { $round: [{ $multiply: [{ $divide: ["$completedTasks", "$totalTasks"] }, 100] }, 0] },
            0,
          ],
        },
      },
    },
  ]);
  const totalStoryPoints = metrics?.totalStoryPoints ?? 0;
  const completedStoryPoints = metrics?.completedStoryPoints ?? 0;
  const durationMs = Math.max(1, sprint.endDate.getTime() - sprint.startDate.getTime());
  const elapsedMs = Math.max(0, Math.min(durationMs, Date.now() - sprint.startDate.getTime()));
  const idealRemaining = Math.round(totalStoryPoints * (1 - elapsedMs / durationMs) * 10) / 10;
  const currentDate = new Date(Math.max(
    sprint.startDate.getTime(),
    Math.min(sprint.endDate.getTime(), Date.now()),
  )).toISOString();
  res.json({
    sprint,
    metrics: {
      totalTasks: metrics?.totalTasks ?? 0,
      completedTasks: metrics?.completedTasks ?? 0,
      completion: metrics?.completion ?? 0,
      velocity: completedStoryPoints,
      completedStoryPoints,
      burndown: [
        { date: sprint.startDate.toISOString(), idealRemaining: totalStoryPoints },
        {
          date: currentDate,
          idealRemaining,
          remainingStoryPoints: Math.max(0, totalStoryPoints - completedStoryPoints),
        },
        { date: sprint.endDate.toISOString(), idealRemaining: 0 },
      ],
    },
  });
}));

export default router;
