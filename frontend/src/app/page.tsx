"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ArrowRight, Check, CircleDollarSign, FileCheck2, LockKeyhole,
  Orbit, ShieldCheck, Sparkles, Workflow
} from "lucide-react";

const principles = [
  {
    icon: ShieldCheck,
    title: "Deterministic controls",
    text: "Policy checks produce explainable decisions before money can move."
  },
  {
    icon: Workflow,
    title: "Evidence in context",
    text: "Procurement, invoice, approval, and payment evidence stay connected."
  },
  {
    icon: LockKeyhole,
    title: "Human authorization",
    text: "AI can recommend and explain, but only authorized people approve payment."
  }
];

const capabilities = [
  "Workspace-scoped procurement controls",
  "Invoice risk and duplicate detection",
  "Approval-ready evidence trails",
  "Server-side integration boundaries"
];

export default function HomePage() {
  return (
    <main className="app-shell min-h-screen overflow-hidden bg-[#07111f] text-slate-100">
      <div className="marketing-backdrop absolute inset-0 -z-10" />
      <div className="grid-bg absolute inset-0 -z-10 opacity-40" />

      <nav className="marketing-nav"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5 lg:px-8">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-blue-600 shadow-[0_0_35px_rgba(56,189,248,.35)]">
            <ShieldCheck size={22} />
          </span>
          <span>InvoiceGuard<span className="text-cyan-300">.</span></span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          <a href="#controls" className="transition hover:text-white">Controls</a>
          <a href="#workflow" className="transition hover:text-white">Workflow</a>
          <a href="#security" className="transition hover:text-white">Security</a>
        </div>
        <div className="flex items-center gap-3"><ThemeToggle /><Link href="/login" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur transition hover:border-cyan-300/50 hover:bg-white/15">Sign in</Link></div></div></nav>

      <section className="mx-auto grid max-w-7xl gap-16 px-6 pb-24 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-8 lg:pb-32 lg:pt-24">
        <div>
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-200">
            <Sparkles size={14} /> Procurement intelligence with guardrails
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }} className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-.05em] text-white sm:text-7xl">
            Move faster without letting risk move faster.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .16 }} className="mt-7 max-w-xl text-lg leading-8 text-slate-300">
            InvoiceGuard connects procurement evidence, deterministic policy decisions, and human approvals into one security-first operating layer.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .24 }} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/setup" className="group inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">
              Create workspace <ArrowRight size={17} className="transition group-hover:translate-x-1" />
            </Link>
            <a href="#workflow" className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 font-medium text-white transition hover:bg-white/10">
              See how it works
            </a>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .15, duration: .6 }} className="relative">
          <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-r from-cyan-400/20 via-blue-500/10 to-fuchsia-500/20 blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/15 bg-slate-950/60 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
              <div><div className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-300">The control model</div><h2 className="mt-2 text-xl font-semibold text-white">Evidence before authorization</h2></div>
              <ShieldCheck size={25} className="shrink-0 text-cyan-300" aria-hidden="true" />
            </div>
            <div className="mt-6 space-y-4">
              <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-sm font-semibold text-cyan-200">01</span>
                <div><h3 className="font-semibold text-white">Collect evidence</h3><p className="mt-1 text-sm leading-6 text-slate-400">Keep invoices, vendor records, purchase orders and supporting documents connected.</p></div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-300/10 text-sm font-semibold text-violet-200">02</span>
                <div><h3 className="font-semibold text-white">Evaluate policy</h3><p className="mt-1 text-sm leading-6 text-slate-400">Apply deterministic checks for duplicates, vendor verification and approval rules.</p></div>
              </div>
              <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-300/10 text-sm font-semibold text-emerald-200">03</span>
                <div><h3 className="font-semibold text-white">Authorize with people</h3><p className="mt-1 text-sm leading-6 text-slate-400">Route decisions to authorized reviewers. AI never approves or captures payment.</p></div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      <section id="controls" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-5 md:grid-cols-3">
          {principles.map(({ icon: Icon, title, text }, index) => <motion.article key={title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * .08 }} className="rounded-3xl border border-white/10 bg-white/[.045] p-6 backdrop-blur">
            <Icon className="text-fuchsia-300" size={22} />
            <h2 className="mt-8 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-3 leading-7 text-slate-400">{text}</p>
          </motion.article>)}
        </div>
      </section>

      <section id="workflow" className="border-y border-white/10 bg-white/[.025]">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8">
          <div><div className="text-sm font-medium uppercase tracking-[.2em] text-cyan-300">Built for accountable teams</div><h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">A calmer path from request to payment.</h2><p className="mt-5 max-w-xl leading-8 text-slate-400">Start with the records your team actually creates. InvoiceGuard keeps empty states honest and makes every next action explicit.</p></div>
          <ul className="grid gap-4 sm:grid-cols-2">{capabilities.map(item => <li key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-200"><Check size={18} className="shrink-0 text-cyan-300" />{item}</li>)}</ul>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-6 py-20 text-center lg:px-8">
        <div className="mx-auto max-w-2xl"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-fuchsia-400/15 text-fuchsia-300"><LockKeyhole size={22} /></div><h2 className="mt-6 text-3xl font-semibold text-white">Security is part of the workflow.</h2><p className="mt-4 leading-7 text-slate-400">No invented activity. No hidden approvals. No AI shortcut around your controls.</p><Link href="/login" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Sign in to your workspace <ArrowRight size={17} /></Link></div>
      </section>

      <footer className="mx-auto flex max-w-7xl justify-between border-t border-white/10 px-6 py-8 text-xs text-slate-500 lg:px-8"><span>InvoiceGuard AI</span><span>AI recommends. Deterministic code decides.</span></footer>
    </main>
  );
}
