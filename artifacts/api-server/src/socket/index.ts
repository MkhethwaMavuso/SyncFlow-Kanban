import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { hasBoardAccess } from "../lib/boards";
import { verifySessionToken } from "../lib/auth";

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    serveClient: false,
  });

  io.use((socket, next) => {
    const token = cookieValue(
      socket.handshake.headers.cookie,
      "syncflow_session",
    );
    const session = verifySessionToken(token);
    if (!session) {
      next(new Error("Authentication required."));
      return;
    }
    socket.data.userId = session.sub;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as number;
    socket.on("board:join", async (payload: unknown) => {
      const boardId =
        typeof payload === "number"
          ? payload
          : typeof payload === "object" &&
              payload !== null &&
              "boardId" in payload
            ? Number((payload as { boardId: unknown }).boardId)
            : NaN;
      if (!Number.isSafeInteger(boardId) || boardId <= 0) return;
      if (!(await hasBoardAccess(boardId, userId))) return;
      await socket.join(`board:${boardId}`);
      socket.emit("board:joined", { boardId });
    });

    socket.on("board:leave", (payload: unknown) => {
      const boardId =
        typeof payload === "number"
          ? payload
          : typeof payload === "object" &&
              payload !== null &&
              "boardId" in payload
            ? Number((payload as { boardId: unknown }).boardId)
            : NaN;
      if (Number.isSafeInteger(boardId) && boardId > 0) {
        void socket.leave(`board:${boardId}`);
      }
    });
  });

  return io;
}
