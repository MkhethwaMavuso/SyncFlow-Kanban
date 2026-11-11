import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { Board } from "../models/Board";

const cookieName = "taskflow_session";

export function signToken(user: { id: string; role: string }) {
  return jwt.sign({ role: user.role }, process.env.JWT_SECRET!, {
    subject: user.id,
    expiresIn: "7d",
  });
}

export function tokenFromCookieHeader(header?: string) {
  const pair = header?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  return pair?.slice(cookieName.length + 1);
}

export function sessionCookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: (production ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromCookieHeader(req.headers.cookie);
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.role !== "string") {
      res.status(401).json({ message: "Invalid session" });
      return;
    }
    req.user = {
      id: payload.sub,
      role: payload.role as NonNullable<Request["user"]>["role"],
    };
    next();
  } catch {
    res.status(401).json({ message: "Session expired or invalid" });
  }
}

export async function requireBoardMember(req: Request, res: Response, next: NextFunction) {
  const boardId = req.params.boardId;
  if (!req.user || !Types.ObjectId.isValid(boardId)) {
    res.status(404).json({ message: "Board not found" });
    return;
  }
  try {
    const board = await Board.findOne({
      _id: boardId,
      $or: [{ owner: req.user.id }, { "members.user": req.user.id }],
    }).select("_id");
    if (!board) {
      res.status(404).json({ message: "Board not found" });
      return;
    }
    req.boardId = board._id;
    next();
  } catch (error) {
    next(error);
  }
}

export async function hasBoardManagerAccess(boardId: string, userId: string) {
  const board = await Board.findOne({
    _id: boardId,
    $or: [
      { owner: userId },
      { members: { $elemMatch: { user: userId, boardRole: { $in: ["PRODUCT_MANAGER", "SCRUM_MASTER"] } } } },
    ],
  }).select("_id");
  return Boolean(board);
}

export { cookieName };
