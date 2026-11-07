import { createInsertSchema } from "drizzle-zod";
import { date, integer, pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { boardsTable } from "./boards";

export const sprintStatus = pgEnum("sprint_status", ["Planned", "Active", "Completed"]);

export const sprintsTable = pgTable("sprints", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id").notNull().references(() => boardsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: sprintStatus("status").notNull().default("Planned"),
  goal: text("goal"),
});

export const insertSprintSchema = createInsertSchema(sprintsTable).omit({ id: true });

export type InsertSprint = z.infer<typeof insertSprintSchema>;
export type Sprint = typeof sprintsTable.$inferSelect;
