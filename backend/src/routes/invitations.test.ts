import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: { invitation: { findUnique: vi.fn() }, $transaction: vi.fn() },
  getSessionUser: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/auth", () => ({ getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "invoiceguard_session" }));

import { invitationRouter } from "./invitations";

describe("workspace invitation acceptance", () => {
  let server: Server;
  let baseUrl: string;
  const token = "long-random-invitation-token-for-test";
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  beforeEach(async () => {
    vi.resetAllMocks();
    const app = express();
    app.use(express.json());
    app.use("/api/workspace/invitations", invitationRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/workspace/invitations`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("does not accept an invitation from a different account email", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-1", email: "someone-else@example.test" });
    mocks.prisma.invitation.findUnique.mockResolvedValue({
      id: "invitation-1", tokenHash, email: "invitee@example.test", workspaceId: "workspace-1", acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000), role: "EMPLOYEE"
    });

    const response = await fetch(`${baseUrl}/${token}/accept`, { method: "POST", headers: { cookie: "invoiceguard_session=session" } });

    expect(response.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("atomically accepts a valid token for the invited account", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-1", email: "invitee@example.test" });
    mocks.prisma.invitation.findUnique.mockResolvedValue({
      id: "invitation-1", tokenHash, email: "invitee@example.test", workspaceId: "workspace-1", acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000), role: "FINANCE"
    });
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ email: "invitee@example.test" }) },
      invitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      membership: { upsert: vi.fn().mockResolvedValue({ id: "membership-1" }) }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/${token}/accept`, { method: "POST", headers: { cookie: "invoiceguard_session=session" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, workspaceId: "workspace-1" });
    expect(tx.invitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "invitation-1", tokenHash, acceptedAt: null })
    }));
    expect(tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: "user-1", workspaceId: "workspace-1", role: "FINANCE" }
    }));
  });
});
