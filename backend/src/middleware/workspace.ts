import { Request, Response, NextFunction } from "express";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { readCookie } from "../lib/cookies";

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string;
      userId?: string;
      role?: string;
    }
  }
}

// Workspace selection is client-supplied, but every selection is checked against
// the authenticated user's database-backed memberships before a request proceeds.
export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ error: "Authentication required." });
    if (!user.emailVerified) return res.status(403).json({ error: "Email verification is required.", code: "EMAIL_VERIFICATION_REQUIRED" });
    const requestedWorkspaceId = req.header("x-workspace-id");
    const membership = user.memberships.find(item => !requestedWorkspaceId || item.workspaceId === requestedWorkspaceId);
    if (!membership) return res.status(403).json({ error: "You do not have access to this workspace." });
    req.workspaceId = membership.workspaceId;
    req.userId = user.id;
    req.role = membership.role;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "Insufficient workspace permissions." });
    }
    next();
  };
}
