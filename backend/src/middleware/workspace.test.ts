import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("../lib/auth", () => ({ getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "invoiceguard_session" }));

import { requireWorkspace } from "./workspace";

describe("workspace membership isolation", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    const app = express();
    app.use(requireWorkspace);
    app.get("/resource", (req, res) => res.json({ workspaceId: req.workspaceId, userId: req.userId, role: req.role }));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/resource`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("rejects a workspace outside the signed-in user's memberships", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", emailVerified: true,
      memberships: [{ workspaceId: "workspace-1", role: "FINANCE" }]
    });

    const response = await fetch(baseUrl, { headers: { cookie: "invoiceguard_session=session", "x-workspace-id": "workspace-other" } });

    expect(response.status).toBe(403);
  });

  it("sets the authorized active workspace and role from membership data", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", emailVerified: true,
      memberships: [{ workspaceId: "workspace-1", role: "EMPLOYEE" }, { workspaceId: "workspace-2", role: "AUDITOR" }]
    });

    const response = await fetch(baseUrl, { headers: { cookie: "invoiceguard_session=session", "x-workspace-id": "workspace-2" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaceId: "workspace-2", userId: "user-1", role: "AUDITOR" });
  });

  it("requires email verification before granting workspace access", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", emailVerified: false,
      memberships: [{ workspaceId: "workspace-1", role: "OWNER" }]
    });

    const response = await fetch(baseUrl, { headers: { cookie: "invoiceguard_session=session" } });

    expect(response.status).toBe(403);
  });
});
