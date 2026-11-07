import { createInsertSchema } from "drizzle-zod";
import { integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const boardMemberRole = pgEnum("board_member_role", ["owner", "member"]);

export const boardsTable = pgTable("boards", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const boardMembersTable = pgTable(
  "board_members",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id").notNull().references(() => boardsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role: boardMemberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("board_members_board_user_unique").on(table.boardId, table.userId)],
);

export const insertBoardSchema = createInsertSchema(boardsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBoard = z.infer<typeof insertBoardSchema>;
export type Board = typeof boardsTable.$inferSelect;
export type BoardMember = typeof boardMembersTable.$inferSelect;
