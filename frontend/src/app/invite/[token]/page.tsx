"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export default function InvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [message, setMessage] = useState("Ready to accept this invitation.");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const result = await apiRequest<{ workspaceId: string }>(`/workspace/invitations/${encodeURIComponent(params.token)}/accept`, { method: "POST" });
      localStorage.setItem("invoiceguard_workspace_id", result.workspaceId);
      router.replace("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to accept invitation.");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell grid min-h-screen place-items-center px-6 text-slate-200">
      <div className="auth-theme-toggle"><ThemeToggle /></div>
    <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[.045] p-8 shadow-2xl">
      <div className="text-xs uppercase tracking-[.2em] text-cyan-300">InvoiceGuard AI</div>
      <h1 className="mt-3 text-3xl font-semibold text-white">Workspace invitation</h1>
      <p className="mt-3 text-slate-400">{message}</p>
      <button onClick={accept} disabled={busy} className="mt-7 w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Accepting..." : "Accept invitation"}</button>
      <p className="mt-5 text-center text-sm text-slate-500">Not signed in with the invited email? <Link href="/login" className="text-cyan-300">Sign in first</Link>, then return to this invitation.</p>
    </section>
  </main>;
}
