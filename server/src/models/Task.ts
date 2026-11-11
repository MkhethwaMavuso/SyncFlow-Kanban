import { InferSchemaType, Model, model, models, Schema } from "mongoose";

export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const taskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 3000 },
    boardId: { type: Schema.Types.ObjectId, ref: "Board", required: true, index: true },
    columnId: { type: Schema.Types.ObjectId, ref: "Column", required: true, index: true },
    sprintId: { type: Schema.Types.ObjectId, ref: "Sprint", default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    priority: { type: String, enum: taskPriorities, default: "MEDIUM", required: true },
    order: { type: Number, required: true },
    dueDate: { type: Date },
    storyPoints: { type: Number, min: 0, max: 100, default: 0 },
  },
  { timestamps: true },
);

taskSchema.index({ boardId: 1, columnId: 1, order: 1 });
taskSchema.index({ sprintId: 1, columnId: 1 });

export type TaskDocument = InferSchemaType<typeof taskSchema>;
export const Task = (models.Task as Model<TaskDocument> | undefined) ?? model<TaskDocument>("Task", taskSchema);
