import mongoose, { ClientSession, Types } from "mongoose";
import { Column } from "../models/Column";
import { Task } from "../models/Task";

export async function boardState(boardId: Types.ObjectId | string, session?: ClientSession) {
  const [columns, tasks] = await Promise.all([
    Column.find({ boardId }).sort({ order: 1 }).session(session ?? null).lean(),
    Task.find({ boardId }).sort({ columnId: 1, order: 1 }).populate("assignedTo", "username").session(session ?? null).lean(),
  ]);
  return { columns, tasks };
}

export async function moveTask(
  boardId: string,
  taskId: string,
  columnId: string,
  destinationIndex?: number,
  taskUpdates: Record<string, unknown> = {},
) {
  const session = await mongoose.startSession();
  try {
    let updatedState: Awaited<ReturnType<typeof boardState>> | undefined;
    await session.withTransaction(async () => {
      const task = await Task.findOne({ _id: taskId, boardId }).session(session);
      if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
      const destination = await Column.findOne({ _id: columnId, boardId }).session(session);
      if (!destination) throw Object.assign(new Error("Column not found"), { status: 404 });
      const sourceColumnId = task.columnId.toString();
      const sameColumn = sourceColumnId === columnId;
      const lockIds = sameColumn ? [sourceColumnId] : [sourceColumnId, columnId];
      await Column.updateMany(
        { _id: { $in: lockIds }, boardId },
        { $inc: { orderingVersion: 1 } },
        { session },
      );

      const sourceTasks = await Task.find({
        boardId,
        columnId: sourceColumnId,
        _id: { $ne: task._id },
      }).sort({ order: 1, _id: 1 }).session(session);

      if (sameColumn) {
        const next = [...sourceTasks];
        const index = Math.max(0, Math.min(destinationIndex ?? task.order, next.length));
        next.splice(index, 0, task);
        const updates = next.flatMap((item, order) => {
          if (item._id.equals(task._id)) return [];
          return [{
            updateOne: {
              filter: { _id: item._id },
              update: { $set: { order } },
            },
          }];
        });
        task.set({ ...taskUpdates, columnId: new Types.ObjectId(columnId), order: index });
        await task.save({ session });
        if (updates.length > 0) await Task.bulkWrite(updates, { session });
      } else {
        const destinationTasks = await Task.find({ boardId, columnId })
          .sort({ order: 1, _id: 1 })
          .session(session);
        const nextDestination = [...destinationTasks];
        const index = Math.max(0, Math.min(destinationIndex ?? nextDestination.length, nextDestination.length));
        nextDestination.splice(index, 0, task);
        task.set({ ...taskUpdates, columnId: new Types.ObjectId(columnId), order: index });
        await task.save({ session });
        const updates = [
          ...sourceTasks.map((item, order) => ({
            updateOne: { filter: { _id: item._id }, update: { $set: { order } } },
          })),
          ...nextDestination.flatMap((item, order) => {
            if (item._id.equals(task._id)) return [];
            return [{
              updateOne: { filter: { _id: item._id }, update: { $set: { order } } },
            }];
          }),
        ];
        if (updates.length > 0) await Task.bulkWrite(updates, { session });
      }
      updatedState = await boardState(boardId, session);
    });
    if (!updatedState) throw new Error("Task move transaction did not complete");
    return updatedState;
  } finally {
    await session.endSession();
  }
}

export async function createTask(
  boardId: string,
  columnId: string,
  values: { title: string; description?: string; priority?: string; dueDate?: Date; storyPoints?: number },
) {
  const session = await mongoose.startSession();
  try {
    let createdId = "";
    await session.withTransaction(async () => {
      const column = await Column.findOneAndUpdate(
        { _id: columnId, boardId },
        { $inc: { orderingVersion: 1 } },
        { new: true, session },
      );
      if (!column) throw Object.assign(new Error("Column not found"), { status: 404 });
      const count = await Task.countDocuments({ boardId, columnId }).session(session);
      const [task] = await Task.create(
        [{ boardId, columnId, order: count, ...values }],
        { session },
      );
      createdId = task.id;
    });
    return Task.findById(createdId).populate("assignedTo", "username").lean();
  } finally {
    await session.endSession();
  }
}

export async function deleteTask(boardId: string, taskId: string) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const task = await Task.findOne({ _id: taskId, boardId }).session(session);
      if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
      await Column.updateOne(
        { _id: task.columnId, boardId },
        { $inc: { orderingVersion: 1 } },
        { session },
      );
      await task.deleteOne({ session });
      const remaining = await Task.find({ boardId, columnId: task.columnId })
        .sort({ order: 1, _id: 1 })
        .session(session);
      if (remaining.length > 0) {
        await Task.bulkWrite(
          remaining.map((item, index) => ({
            updateOne: { filter: { _id: item._id }, update: { $set: { order: index } } },
          })),
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
}
