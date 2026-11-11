import { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof Error && error.message === "Origin is not allowed by CORS") {
    res.status(403).json({ message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Invalid request", issues: error.issues });
    return;
  };
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    res.status(409).json({ message: "A record with these unique values already exists" });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    const message = "message" in error && typeof error.message === "string"
      ? error.message
      : "Request could not be completed";
    res.status(error.status).json({ message });
    return;
  }
  console.error(error);
  res.status(500).json({ message: "Internal server error" });
}
