import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: { $transaction: vi.fn() },
  recordAuditEvent: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { workspaceRouter } from "./workspace";

describe("workspace owner role protections", () => {
  let server: Server;
  let baseUrl: string;
  let role: "OWNER" | "ADMIN";

  beforeEach(async () => {
    vi.resetAllMocks();
    role = "ADMIN";
    mocks.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "workspace-1";
      req.userId = "owner-1";
      req.role = role;
      next();
    });
    app.use("/api/workspace", workspaceRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/workspace`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("does not let an admin grant the owner role", async () => {
    const tx = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({ id: "membership-1", userId: "member-1", role: "EMPLOYEE" }),
        count: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn()
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/members/membership-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "OWNER" })
    });

    expect(response.status).toBe(403);
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it("prevents the active owner from removing their own owner role", async () => {
    role = "OWNER";
    const tx = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({ id: "membership-1", userId: "owner-1", role: "OWNER" }),
        count: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn()
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/members/membership-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "ADMIN" })
    });

    expect(response.status).toBe(403);
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
  });

  it("allows an owner to promote a non-owner and records the change", async () => {
    role = "OWNER";
    const tx = {
      membership: {
        findFirst: vi.fn().mockResolvedValue({ id: "membership-1", userId: "member-1", role: "EMPLOYEE" }),
        count: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "membership-1", role: "ADMIN" })
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/members/membership-1`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "ADMIN" })
    });

    expect(response.status).toBe(200);
    expect(tx.membership.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "membership-1", workspaceId: "workspace-1", role: "EMPLOYEE" }, data: { role: "ADMIN" }
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledOnce();
  });
});
