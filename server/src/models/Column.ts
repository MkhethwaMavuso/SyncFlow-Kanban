import { InferSchemaType, Model, model, models, Schema } from "mongoose";

const columnSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 60 },
    boardId: { type: Schema.Types.ObjectId, ref: "Board", required: true, index: true },
    order: { type: Number, required: true },
    orderingVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

columnSchema.index({ boardId: 1, order: 1 }, { unique: true });

export type ColumnDocument = InferSchemaType<typeof columnSchema>;
export const Column = (models.Column as Model<ColumnDocument> | undefined) ?? model<ColumnDocument>("Column", columnSchema);
