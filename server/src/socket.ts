import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { z } from "zod";
import { Board } from "./models/Board";
import { Column } from "./models/Column";
import { Task, taskPriorities } from "./models/Task";
import { hasBoardManagerAccess, tokenFromCookieHeader } from "./middleware/auth";
import { boardState, createTask, deleteTask, moveTask } from "./services/tasks";

async function mayUseBoard(socket: Socket, boardId: string) {
  if (!socket.rooms.has(boardId)) return false;
  try {
    const member = await Board.exists({
      _id: boardId,
      $or: [{ owner: socket.data.userId }, { "members.user": socket.data.userId }],
    });
    if (member) return true;
    await socket.leave(boardId);
    socket.emit("board:error", { message: "Your access to this board has changed" });
    return false;
  } catch (error) {
    console.error("Could not verify socket board access", error);
    socket.emit("board:error", { message: "Could not verify board access" });
    return false;
  }
}

function operationErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const status = "status" in error ? error.status : undefined;
    const message = "message" in error ? error.message : undefined;
    if (typeof status === "number" && status >= 400 && status < 500 && typeof message === "string") {
      return message;
    }
  }
  console.error(error);
  return fallback;
}

export function attachSocketHandlers(io: Server) {
  const objectId = z.string().refine((value) => Types.ObjectId.isValid(value), "Invalid ID");
  io.use((socket, next) => {
    try {
      const token = tokenFromCookieHeader(socket.handshake.headers.cookie);
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
      if (!payload.sub) return next(new Error("Invalid session"));
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Session expired or invalid"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("board:join", async (boardId: unknown) => {
      if (typeof boardId !== "string") return;
      if (!Types.ObjectId.isValid(boardId)) {
        socket.emit("board:error", { message: "Invalid board ID" });
        return;
      }
      try {
        const board = await Board.findOne({
          _id: boardId,
          $or: [{ owner: socket.data.userId }, { "members.user": socket.data.userId }],
        }).select("_id");
        if (!board) {
          socket.emit("board:error", { message: "Board not found or access denied" });
          return;
        }
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        await socket.join(boardId);
        socket.emit("board:state-updated", await boardState(boardId));
        io.to(boardId).emit("board:presence", (await io.in(boardId).fetchSockets()).length);
      } catch (error) {
        console.error("Could not join board room", error);
        socket.emit("board:error", { message: "Could not join this board" });
      }
    });

    socket.on("task:move", async (payload: unknown) => {
      const input = z.object({
        boardId: objectId,
        taskId: objectId,
        columnId: objectId,
        index: z.number().int().min(0).max(10000),
      }).safeParse(payload);
      if (!input.success) return socket.emit("board:error", { message: "Invalid task move" });
      try {
        if (!await mayUseBoard(socket, input.data.boardId)) return;
        const state = await moveTask(
          input.data.boardId,
          input.data.taskId,
          input.data.columnId,
          input.data.index,
        );
        io.to(input.data.boardId).emit("board:state-updated", state);
      } catch (error) {
        socket.emit("board:error", { message: operationErrorMessage(error, "Unable to move task") });
      }
    });

    socket.on("task:create", async (payload: unknown) => {
      const input = z.object({
        boardId: objectId,
        columnId: objectId,
        title: z.string().trim().min(1).max(160),
        description: z.string().max(3000).optional(),
        priority: z.enum(taskPriorities).optional(),
      }).safeParse(payload);
      if (!input.success) return socket.emit("board:error", { message: "Invalid task details" });
      try {
        if (!await mayUseBoard(socket, input.data.boardId)) return;
        await createTask(input.data.boardId, input.data.columnId, input.data);
        io.to(input.data.boardId).emit(
          "board:state-updated",
          await boardState(input.data.boardId),
        );
      } catch (error) {
        socket.emit("board:error", { message: operationErrorMessage(error, "Unable to create task") });
      }
    });

    socket.on("task:update", async (payload: unknown) => {
      const input = z.object({
        boardId: objectId,
        taskId: objectId,
        title: z.string().trim().min(1).max(160).optional(),
        description: z.string().max(3000).optional(),
        priority: z.enum(taskPriorities).optional(),
      }).strict().safeParse(payload);
      if (!input.success) return socket.emit("board:error", { message: "Invalid task update" });
      try {
        if (!await mayUseBoard(socket, input.data.boardId)) return;
        const { boardId, taskId, ...changes } = input.data;
        const result = await Task.updateOne(
          { _id: taskId, boardId },
          { $set: changes },
          { runValidators: true },
        );
        if (result.matchedCount === 0) throw Object.assign(new Error("Task not found"), { status: 404 });
        io.to(boardId).emit("board:state-updated", await boardState(boardId));
      } catch (error) {
        socket.emit("board:error", { message: operationErrorMessage(error, "Unable to update task") });
      }
    });

    socket.on("task:delete", async (payload: unknown) => {
      const input = z.object({
        boardId: objectId,
        taskId: objectId,
      }).safeParse(payload);
      if (!input.success) return socket.emit("board:error", { message: "Invalid task deletion" });
      try {
        if (!await mayUseBoard(socket, input.data.boardId)) return;
        await deleteTask(input.data.boardId, input.data.taskId);
        io.to(input.data.boardId).emit(
          "board:state-updated",
          await boardState(input.data.boardId),
        );
      } catch (error) {
        socket.emit("board:error", { message: operationErrorMessage(error, "Unable to delete task") });
      }
    });

    socket.on("column:create", async (payload: unknown) => {
      const input = z.object({
        boardId: objectId,
        title: z.string().trim().min(1).max(60),
      }).safeParse(payload);
      if (!input.success) return socket.emit("board:error", { message: "Invalid column details" });
      try {
        if (!await mayUseBoard(socket, input.data.boardId)) return;
        if (!await hasBoardManagerAccess(input.data.boardId, socket.data.userId)) {
          throw Object.assign(new Error("Board manager role required"), { status: 403 });
        }
        const board = await Board.findByIdAndUpdate(
          input.data.boardId,
          { $inc: { nextColumnOrder: 1 } },
          { new: true },
        );
        if (!board) throw Object.assign(new Error("Board not found"), { status: 404 });
        await Column.create({
          title: input.data.title,
          boardId: input.data.boardId,
          order: board.nextColumnOrder - 1,
        });
        io.to(input.data.boardId).emit(
          "board:state-updated",
          await boardState(input.data.boardId),
        );
      } catch (error) {
        socket.emit("board:error", { message: operationErrorMessage(error, "Unable to create column") });
      }
    });

    socket.on("disconnecting", async () => {
      for (const room of socket.rooms) {
        if (room === socket.id) continue;
        try {
          io.to(room).emit(
            "board:presence",
            Math.max(0, (await io.in(room).fetchSockets()).length - 1),
          );
        } catch (error) {
          console.error("Could not update board presence", error);
        }
      }
    });
  });
}
