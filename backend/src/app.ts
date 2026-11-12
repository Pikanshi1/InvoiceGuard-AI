import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { MulterError } from "multer";
import { healthRouter } from "./routes/health";
import { invoiceRouter } from "./routes/invoices";
import { vendorRouter } from "./routes/vendors";
import { policyRouter } from "./routes/policies";
import { requireWorkspace } from "./middleware/workspace";
import { authRouter } from "./routes/auth";
import { procurementRouter } from "./routes/procurement";
import { governanceRouter } from "./routes/governance";
import { dashboardRouter } from "./routes/dashboard";
import { integrationsRouter } from "./routes/integrations";
import { workspaceRouter } from "./routes/workspace";
import { documentRouter } from "./routes/documents";
import { remainingRouter } from "./routes/remaining";
import { securityRouter } from "./routes/security";
import { agreementRouter } from "./routes/agreements";
import { vendorDocumentRouter } from "./routes/vendor-documents";
import { quotationDocumentRouter } from "./routes/quotation-documents";
import { invitationRouter } from "./routes/invitations";
import { readCookie } from "./lib/cookies";
import { SESSION_COOKIE } from "./lib/auth";
import crypto from "node:crypto";
import { getRuntimeConfig } from "./lib/config";
import { logServerError } from "./lib/logging";

export const app = express();
const config = getRuntimeConfig();
if (config.trustProxyHops !== null) app.set("trust proxy", config.trustProxyHops);
app.use(helmet());
const webOrigin = config.webOrigin;
app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use((_req, res, next) => {
  const requestId = crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !readCookie(req, SESSION_COOKIE)) return next();
  try {
    const referer = req.get("referer");
    const suppliedOrigin = req.get("origin") ?? (referer ? new URL(referer).origin : undefined);
    if (!suppliedOrigin) return res.status(403).json({ error: "A same-origin request is required." });
    if (new URL(suppliedOrigin).origin !== new URL(webOrigin).origin) return res.status(403).json({ error: "Cross-origin request rejected." });
  } catch {
    return res.status(403).json({ error: "Cross-origin request rejected." });
  }
  next();
});
for (const path of ["/api/auth/login", "/api/auth/setup", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/resend-verification"]) {
  app.use(path, rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false }));
}
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/workspace/invitations", invitationRouter);
app.use("/api", requireWorkspace);
app.use("/api/invoices", invoiceRouter);
app.use("/api/vendors", vendorRouter);
app.use("/api/policies", policyRouter);
app.use("/api/procurement", procurementRouter);
app.use("/api/governance", governanceRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/workspace", workspaceRouter);
app.use("/api/invoices", documentRouter);
app.use("/api", remainingRouter);
app.use("/api/security", securityRouter);
app.use("/api/agreements", agreementRouter);
app.use("/api/vendors", vendorDocumentRouter);
app.use("/api/procurement/quotations", quotationDocumentRouter);
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof MulterError) {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large." : "Invalid multipart upload." });
  }
  if (err && typeof err === "object" && "issues" in err) {
    const issues = Array.isArray((err as { issues?: unknown }).issues) ? (err as { issues: unknown[] }).issues : [];
    const details = issues.map(issue => {
      if (!issue || typeof issue !== "object") return { message: "Invalid value." };
      const item = issue as { path?: unknown; code?: unknown; message?: unknown };
      return {
        path: Array.isArray(item.path) ? item.path.filter(part => typeof part === "string" || typeof part === "number") : [],
        code: typeof item.code === "string" ? item.code : "invalid_value",
        message: typeof item.message === "string" ? item.message : "Invalid value."
      };
    });
    return res.status(400).json({ error: "Validation failed", details });
  }
  if (err && typeof err === "object" && "code" in err && (err as any).code === "P2002") return res.status(409).json({ error: "A record with the same unique value already exists." });
  if (err && typeof err === "object" && "code" in err && (err as any).code === "SETUP_COMPLETE") return res.status(409).json({ error: "Initial setup has already been completed." });
  logServerError("api_unhandled_error", err, res.locals.requestId);
  res.status(500).json({ error: "Unexpected server error." });
});
