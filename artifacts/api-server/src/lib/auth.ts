import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "syncflow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function loadSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured to sign user sessions.");
  }
  return secret;
}

const sessionSecret = loadSessionSecret();

type SessionPayload = {
  sub: number;
  exp: number;
};

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signatureFor(value: string): Buffer {
  return createHmac("sha256", sessionSecret).update(value).digest();
}

export function createSessionToken(userId: number): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    } satisfies SessionPayload),
  );
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${signatureFor(unsignedToken).toString("base64url")}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, providedSignature] = parts;
  if (!header || !payload || !providedSignature) return null;

  const unsignedToken = `${header}.${payload}`;
  const expectedSignature = signatureFor(unsignedToken);
  const actualSignature = Buffer.from(providedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (
      typeof parsed.sub !== "number" ||
      !Number.isInteger(parsed.sub) ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return { sub: parsed.sub, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: number): void {
  res.cookie(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const session = verifySessionToken(token);

  if (!session) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  req.userId = session.sub;
  next();
}

export function userIdFromRequest(req: Request): number {
  if (!req.userId) {
    throw new Error("Authenticated user ID is missing from the request.");
  }
  return req.userId;
}
