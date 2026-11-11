import { Types } from "mongoose";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: "PRODUCT_MANAGER" | "SCRUM_MASTER" | "DEVELOPER" };
      boardId?: Types.ObjectId;
    }
  }
}

export {};
