import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { z } from "zod";
import { Board } from "../models/Board";
import { Column } from "../models/Column";
import { User } from "../models/User";
import { authenticate, cookieName, sessionCookieOptions, signToken } from "../middleware/auth";
import { asyncRoute } from "../utils/errors";

const router = Router();
const password = z.string()
  .min(8)
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password cannot exceed 72 UTF-8 bytes");
const credentials = z.object({
  email: z.string().email().max(254),
  password,
});
const registration = credentials.extend({ username: z.string().trim().min(2).max(40) });

router.post("/register", asyncRoute(async (req, res) => {
  const input = registration.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const session = await mongoose.startSession();
  let userId!: string;
  let boardId!: string;
  try {
    await session.withTransaction(async () => {
      const [user] = await User.create(
        [{ username: input.username, email: input.email, passwordHash, role: "DEVELOPER" }],
        { session },
      );
      const [board] = await Board.create(
        [{
          title: "Product workspace",
          description: "Plan, track, and ship work together.",
          owner: user._id,
          nextColumnOrder: 4,
          members: [{ user: user._id, boardRole: "PRODUCT_MANAGER" }],
        }],
        { session },
      );
      await Column.insertMany(
        ["To do", "In progress", "In review", "Done"].map((title, order) => ({
          title,
          boardId: board._id,
          order,
        })),
        { session },
      );
      userId = user.id;
      boardId = board.id;
    });
  } finally {
    await session.endSession();
  }
  res.cookie(cookieName, signToken({ id: userId, role: "DEVELOPER" }), sessionCookieOptions());
  res.status(201).json({ user: { id: userId, username: input.username, email: input.email }, boardId });
}));

router.post("/login", asyncRoute(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    res.status(401).json({ message: "Invalid email or password" });
    return;
  }
  res.cookie(cookieName, signToken({ id: user.id, role: user.role }), sessionCookieOptions());
  res.json({ user: { id: user.id, username: user.username, email: user.email } });
}));

router.post("/logout", (_req, res) => {
  res.clearCookie(cookieName, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get("/me", authenticate, asyncRoute(async (req, res) => {
  const user = await User.findById(req.user?.id).select("username email role");
  if (!user) {
    res.status(401).json({ message: "User no longer exists" });
    return;
  }
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}));

export default router;
