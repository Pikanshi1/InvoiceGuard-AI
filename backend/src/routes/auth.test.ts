import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    session: { deleteMany: vi.fn() },
    emailVerificationToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    passwordResetToken: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn()
  },
  bcrypt: { compare: vi.fn(), hash: vi.fn() },
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionUser: vi.fn(),
  hashSessionToken: vi.fn((token: string) => `hashed:${token}`),
  gmailConfigured: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/auth", () => ({
  bcrypt: mocks.bcrypt,
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
  getSessionUser: mocks.getSessionUser,
  hashSessionToken: mocks.hashSessionToken,
  SESSION_COOKIE: "invoiceguard_session",
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: "lax", path: "/" })
}));
vi.mock("../lib/email", () => ({
  gmailConfigured: mocks.gmailConfigured,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  sendVerificationEmail: mocks.sendVerificationEmail
}));

import { authRouter } from "./auth";

describe("authentication lifecycle routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.gmailConfigured.mockReturnValue(true);
    mocks.sendVerificationEmail.mockResolvedValue(undefined);
    mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/api/auth`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("registers the first owner and sends verification without returning the token", async () => {
    const user = {
      id: "user-1", email: "owner@example.test", name: "Workspace Owner", avatarUrl: null, emailVerified: false,
      memberships: [{ id: "membership-1", role: "OWNER", workspace: { id: "workspace-1", name: "Example" } }]
    };
    const tx = {
      user: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue(user) },
      emailVerificationToken: { create: vi.fn().mockResolvedValue({ id: "verify-1" }) }
    };
    mocks.bcrypt.hash.mockResolvedValue("password-hash");
    mocks.createSession.mockResolvedValue({ token: "session-token", expiresAt: new Date(Date.now() + 60_000) });
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/setup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "a-strong-password-123", name: user.name, workspaceName: "Example Workspace" })
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.user).toMatchObject({ id: user.id, email: user.email, emailVerified: false });
    expect(JSON.stringify(result)).not.toContain("verificationToken");
    expect(tx.user.create).toHaveBeenCalledOnce();
    expect(mocks.sendVerificationEmail).toHaveBeenCalledOnce();
  });

  it("does not create a session for invalid login credentials", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "user-1", passwordHash: "stored-hash" });
    mocks.bcrypt.compare.mockResolvedValue(false);

    const response = await fetch(`${baseUrl}/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "wrong-password" })
    });

    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("consumes email verification tokens atomically", async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValue({ id: "verify-1", userId: "user-1", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    const tx = {
      emailVerificationToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      user: { update: vi.fn().mockResolvedValue({ id: "user-1", emailVerified: true }) }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/verify-email`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "a-long-verification-token-value" })
    });

    expect(response.status).toBe(200);
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ usedAt: null }) }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { emailVerified: true } });
  });

  it("changes a password and revokes sessions in the same transaction", async () => {
    mocks.prisma.passwordResetToken.findUnique.mockResolvedValue({ id: "reset-1", userId: "user-1", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    mocks.bcrypt.hash.mockResolvedValue("new-password-hash");
    const tx = {
      passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { update: vi.fn().mockResolvedValue({ id: "user-1" }) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const response = await fetch(`${baseUrl}/reset-password`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "a-long-password-reset-token-value", password: "a-new-strong-password-123" })
    });

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { passwordHash: "new-password-hash" } });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });
});
