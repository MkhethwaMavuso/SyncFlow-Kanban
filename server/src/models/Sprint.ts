import { InferSchemaType, Model, model, models, Schema } from "mongoose";

const sprintSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    boardId: { type: Schema.Types.ObjectId, ref: "Board", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["PLANNING", "ACTIVE", "COMPLETED"],
      default: "PLANNING",
      required: true,
    },
    metrics: {
      velocity: { type: Number, default: 0 },
      completedStoryPoints: { type: Number, default: 0 },
      burndown: { type: [Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true },
);

sprintSchema.index({ boardId: 1, status: 1, startDate: -1 });
sprintSchema.index({ boardId: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });

export type SprintDocument = InferSchemaType<typeof sprintSchema>;
export const Sprint = (models.Sprint as Model<SprintDocument> | undefined) ?? model<SprintDocument>("Sprint", sprintSchema);
