"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiRequest<{ user: { emailVerified: boolean } }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push(result.user.emailVerified ? "/dashboard" : "/verify-email/pending");
    }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); } finally { setBusy(false); }
  }
  return <main className="auth-shell grid min-h-screen items-center justify-center overflow-hidden px-6 py-12 text-slate-100">
      <div className="auth-theme-toggle"><ThemeToggle /></div><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 shadow-2xl backdrop-blur-xl"><div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-600 shadow-[0_0_30px_rgba(34,211,238,.3)]"><ShieldCheck size={21}/></span>InvoiceGuard<span className="text-cyan-300">.</span></Link></div><div className="mt-10 flex items-center gap-2 text-xs font-medium uppercase tracking-[.2em] text-fuchsia-300"><Sparkles size={14}/> Secure access</div><h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Welcome back</h1><p className="mt-2 text-sm text-slate-400">Sign in to your secure workspace.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm text-slate-300">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="field mt-2 w-full rounded-xl px-4 py-3"/></label><label className="block text-sm text-slate-300">Password<div className="relative mt-2"><input required type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} className="field w-full rounded-xl px-4 py-3 pr-12"/><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-cyan-200">{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><div className="flex justify-end"><Link href="/forgot-password" className="text-sm text-cyan-300 transition hover:text-fuchsia-300">Forgot password?</Link></div>{error && <p className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}<button disabled={busy} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-4 py-3 font-semibold text-slate-950 transition hover:scale-[1.01] hover:shadow-[0_0_30px_rgba(217,70,239,.25)] disabled:opacity-60">{busy ? "Signing in..." : "Sign in"}<ArrowRight size={17} className="transition group-hover:translate-x-1"/></button></form><p className="mt-7 text-center text-sm text-slate-500">First time here? <Link href="/setup" className="text-cyan-300 transition hover:text-fuchsia-300">Create the owner workspace</Link></p></div></main>;
}
