import { createInsertSchema } from "drizzle-zod";
import { integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { boardsTable } from "./boards";
import { sprintsTable } from "./sprints";
import { usersTable } from "./users";

export const taskStatus = pgEnum("task_status", ["Backlog", "Todo", "In Progress", "Review", "Done"]);
export const taskPriority = pgEnum("task_priority", ["Low", "Medium", "High", "Urgent"]);

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id").notNull().references(() => boardsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatus("status").notNull().default("Backlog"),
  priority: taskPriority("priority").notNull().default("Medium"),
  assigneeId: integer("assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date", { withTimezone: true }),
  sprintId: integer("sprint_id").references(() => sprintsTable.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  createdBy: integer("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
