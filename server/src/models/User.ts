import { InferSchemaType, Model, model, models, Schema } from "mongoose";

export const userRoles = ["PRODUCT_MANAGER", "SCRUM_MASTER", "DEVELOPER"] as const;

const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: userRoles, default: "DEVELOPER", required: true },
  },
  { timestamps: true },
);

userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = (models.User as Model<UserDocument> | undefined) ?? model<UserDocument>("User", userSchema);
