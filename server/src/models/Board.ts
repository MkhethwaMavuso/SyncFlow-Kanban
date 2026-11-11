import { InferSchemaType, Model, model, models, Schema, Types } from "mongoose";
import { userRoles } from "./User";

const boardSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: "", maxlength: 1000 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    nextColumnOrder: { type: Number, default: 4 },
    columnOrderVersion: { type: Number, default: 0 },
    members: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        boardRole: { type: String, enum: userRoles, required: true },
      },
    ],
  },
  { timestamps: true },
);

boardSchema.index({ owner: 1 });
boardSchema.index({ "members.user": 1 });

export type BoardDocument = InferSchemaType<typeof boardSchema>;
export const Board = (models.Board as Model<BoardDocument> | undefined) ?? model<BoardDocument>("Board", boardSchema);
export type BoardMemberId = Types.ObjectId;
