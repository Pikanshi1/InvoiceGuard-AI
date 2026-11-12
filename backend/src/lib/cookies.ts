import type { Request } from "express";

export function readCookie(req: Request, name: string) {
  const cookies = req.headers.cookie?.split(";") ?? [];
  const entry = cookies.find(cookie => cookie.trim().startsWith(`${name}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return undefined;
  }
}
