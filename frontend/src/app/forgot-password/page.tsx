"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to prepare reset instructions."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell grid min-h-screen items-center justify-center overflow-hidden px-6 py-12 text-slate-100"><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 shadow-2xl backdrop-blur-xl"><div className="flex justify-end"><ThemeToggle /></div><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-600"><ShieldCheck size={21}/></span>InvoiceGuard<span className="text-cyan-300">.</span></Link><div className="mt-10 grid h-12 w-12 place-items-center rounded-2xl bg-fuchsia-400/15 text-fuchsia-300"><KeyRound size={23}/></div><h1 className="mt-6 text-3xl font-semibold text-white">Reset your password</h1><p className="mt-2 text-sm leading-6 text-slate-400">Enter your account email. If it exists, we will prepare a secure one-hour reset link.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm text-slate-300">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="field mt-2 w-full rounded-xl px-4 py-3"/></label>{message && <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100">{message}</p>}<button disabled={busy} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-4 py-3 font-semibold text-slate-950 transition hover:scale-[1.01] disabled:opacity-60">{busy ? "Preparing..." : "Send reset instructions"}<ArrowRight size={17} className="transition group-hover:translate-x-1"/></button></form><Link href="/login" className="mt-7 flex items-center justify-center gap-2 text-sm text-slate-500 transition hover:text-cyan-200"><ArrowLeft size={15}/> Back to sign in</Link></div></main>;
}
