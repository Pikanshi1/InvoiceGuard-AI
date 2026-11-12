"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function update(key: keyof typeof form, value: string) { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest<{ user: unknown }>("/auth/setup", { method: "POST", body: JSON.stringify(form) }); router.push("/verify-email/pending"); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to complete setup."); } finally { setBusy(false); }
  }
  return <main className="auth-shell grid min-h-screen items-center justify-center overflow-hidden px-6 py-12 text-slate-100">
      <div className="auth-theme-toggle"><ThemeToggle /></div><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 shadow-2xl backdrop-blur-xl"><div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3 font-semibold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-600"><ShieldCheck size={21}/></span>InvoiceGuard<span className="text-cyan-300">.</span></Link></div><h1 className="mt-10 text-3xl font-semibold text-white">Create your workspace</h1><p className="mt-2 text-sm text-slate-400">This one-time flow creates the first owner. No sample records are added.</p><form onSubmit={submit} className="mt-8 space-y-4">{[["name","Your name","text"],["workspaceName","Workspace name","text"],["email","Email","email"],["password","Password (12+ characters)","password"]].map(([key,label,type]) => <label key={key} className="block text-sm text-slate-300">{label}<input required minLength={key === "password" ? 12 : 2} type={type} value={form[key as keyof typeof form]} onChange={event => update(key as keyof typeof form, event.target.value)} className="field mt-2 w-full rounded-xl px-4 py-3"/></label>)}{error && <p className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}<button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-4 py-3 font-semibold text-slate-950 transition hover:scale-[1.01] disabled:opacity-60">{busy ? "Creating..." : "Create owner workspace"}<ArrowRight size={17}/></button></form><p className="mt-6 text-center text-sm text-slate-500">Already configured? <Link href="/login" className="text-cyan-300">Sign in</Link></p></div></main>;
}
