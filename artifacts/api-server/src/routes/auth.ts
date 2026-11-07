import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  boardMembersTable,
  boardsTable,
  db,
  sprintsTable,
  tasksTable,
  usersTable,
} from "@workspace/db";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  userIdFromRequest,
} from "../lib/auth";

const router: IRouter = Router();

function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!name) {
    res.status(400).json({ error: "Name is required." });
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const sessionUser = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({ name, email, passwordHash })
        .returning();
      if (!user) throw new Error("Account could not be created.");

      const [board] = await tx
        .insert(boardsTable)
        .values({ title: "Launch operations", ownerId: user.id })
        .returning();
      if (!board) throw new Error("Starter board could not be created.");

      await tx.insert(boardMembersTable).values({
        boardId: board.id,
        userId: user.id,
        role: "owner",
      });

      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const end = new Date(today);
      end.setDate(end.getDate() + 14);
      const [sprint] = await tx
        .insert(sprintsTable)
        .values({
          boardId: board.id,
          name: "Sprint 01",
          startDate,
          endDate: end.toISOString().slice(0, 10),
          status: "Active",
          goal: "Get the launch essentials ready.",
        })
        .returning();

      if (sprint) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 3);
        await tx.insert(tasksTable).values([
          {
            boardId: board.id,
            title: "Map the onboarding journey",
            description: "Document the first-session experience from sign-up to first success.",
            status: "In Progress",
            priority: "High",
            sprintId: sprint.id,
            dueDate,
            createdBy: user.id,
            position: 0,
          },
          {
            boardId: board.id,
            title: "Prepare the release checklist",
            description: "Capture launch owners, checks, and the go/no-go criteria.",
            status: "Todo",
            priority: "Medium",
            sprintId: sprint.id,
            createdBy: user.id,
            position: 0,
          },
          {
            boardId: board.id,
            title: "Review mobile sign-in",
            description: "Confirm the account flow is clear on smaller screens.",
            status: "Backlog",
            priority: "Urgent",
            sprintId: sprint.id,
            createdBy: user.id,
            position: 0,
          },
          {
            boardId: board.id,
            title: "Share launch notes",
            description: "Gather the final update for the team.",
            status: "Done",
            priority: "Low",
            sprintId: sprint.id,
            createdBy: user.id,
            position: 0,
          },
        ]);
      }

      await tx.insert(activityTable).values({
        boardId: board.id,
        actorId: user.id,
        actorName: user.name,
        action: "created the workspace",
        target: board.title,
      });
      return user;
    });

    setSessionCookie(res, sessionUser.id);
    res.status(201).json(
      RegisterResponse.parse({ user: publicUser(sessionUser) }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }

  setSessionCookie(res, user.id);
  res.json(LoginResponse.parse({ user: publicUser(user) }));
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = userIdFromRequest(req);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  res.json(GetCurrentUserResponse.parse(publicUser(user)));
});

export default router;
