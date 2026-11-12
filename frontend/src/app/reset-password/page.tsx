"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const resetToken = params.get("token");
    setToken(resetToken);
    if (resetToken) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [params]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try { await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }); router.replace("/login?reset=success"); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to reset password."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell grid min-h-screen items-center justify-center overflow-hidden px-6 py-12 text-slate-100"><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 shadow-2xl backdrop-blur-xl"><div className="flex justify-end"><ThemeToggle /></div><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-600"><ShieldCheck size={21}/></span>InvoiceGuard<span className="text-cyan-300">.</span></Link><div className="mt-10 grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300/15 text-cyan-300"><KeyRound size={23}/></div><h1 className="mt-6 text-3xl font-semibold text-white">Choose a new password</h1><p className="mt-2 text-sm leading-6 text-slate-400">Use at least 12 characters. All active sessions will be signed out.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm text-slate-300">New password<input required minLength={12} type="password" value={password} onChange={event => setPassword(event.target.value)} className="field mt-2 w-full rounded-xl px-4 py-3"/></label><label className="block text-sm text-slate-300">Confirm password<input required minLength={12} type="password" value={confirm} onChange={event => setConfirm(event.target.value)} className="field mt-2 w-full rounded-xl px-4 py-3"/></label>{error && <p className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}<button disabled={busy || !token} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-4 py-3 font-semibold text-slate-950 transition hover:scale-[1.01] disabled:opacity-60">{busy ? "Updating..." : "Update password"}<ArrowRight size={17}/></button></form></div></main>;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="auth-shell min-h-screen" />}><ResetPasswordForm /></Suspense>;
}
