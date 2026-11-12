"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

function VerifyEmailForm() {
  const params = useSearchParams();
  const verificationStarted = useRef(false);
  const [message, setMessage] = useState("Verifying your email...");
  const [error, setError] = useState("");
  useEffect(() => {
    const token = params.get("token");
    if (!token) { setError("Verification token is missing."); setMessage(""); return; }
    if (verificationStarted.current) return;
    verificationStarted.current = true;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    apiRequest<{ message: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(result => setMessage(result.message))
      .catch(reason => { setError(reason instanceof Error ? reason.message : "Unable to verify email."); setMessage(""); });
  }, [params]);
  return <main className="auth-shell grid min-h-screen place-items-center px-6 text-slate-100">
      <div className="auth-theme-toggle"><ThemeToggle /></div><div className="auth-card w-full max-w-md rounded-[2rem] border border-white/10 p-8 text-center shadow-2xl backdrop-blur-xl"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-300 text-slate-950"><CheckCircle2 size={24}/></span><div className="mt-5 flex items-center justify-center gap-2 font-semibold"><ShieldCheck className="text-cyan-300" size={18}/> InvoiceGuard<span className="text-cyan-300">.</span></div><h1 className="mt-6 text-3xl font-semibold text-white">{error ? "Verification failed" : "Email verification"}</h1><p className={error ? "mt-3 text-sm text-rose-200" : "mt-3 text-sm text-slate-400"}>{error || message}</p><Link href="/login" className="mt-8 inline-flex rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-5 py-3 font-semibold text-slate-950">Continue to sign in</Link></div></main>;
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<main className="auth-shell min-h-screen" />}><VerifyEmailForm /></Suspense>;
}
