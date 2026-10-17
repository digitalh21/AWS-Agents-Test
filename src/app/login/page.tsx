"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PhoneCall, ShieldCheck, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";

const DEMO = [
  { email: "admin@crm.app", label: "Admin", icon: ShieldCheck, hint: "Full control, deletes, cron" },
  { email: "hr@crm.app", label: "HR", icon: Users, hint: "KYC, payouts, agents" },
  { email: "manager@crm.app", label: "Manager", icon: PhoneCall, hint: "Pipeline, approvals, calls" },
  { email: "agent1@crm.app", label: "Telecaller", icon: Wallet, hint: "Mobile lead console" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("agent1@crm.app");
  const [password, setPassword] = useState("password123");
  const [busy, setBusy] = useState(false);

  async function signIn(nextEmail = email, nextPassword = password) {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      });
      const json = (await res.json()) as { error?: string; redirect?: string };
      if (!res.ok) throw new Error(json.error ?? "Login failed");
      toast.success("Signed in");
      router.replace(json.redirect ?? "/agent");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col lg:flex-row">
      {/* theme selector available BEFORE authentication (Day / Dark / Grown) */}
      <div className="absolute right-3 top-3 z-50">
        <ThemeSwitcher />
      </div>
      <section className="relative flex flex-col justify-between gap-6 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 p-5 pb-8 text-white sm:p-8 lg:w-1/2 lg:p-12">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-blue-700 shadow-lg">
              AGS
            </span>
            <div>
              <p className="text-xl font-extrabold leading-none tracking-tight sm:text-2xl">Auto Growth Systems</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-blue-200">
                Telecalling CRM &amp; HR Suite
              </p>
            </div>
          </div>
          <h1 className="mt-7 max-w-md text-2xl font-bold leading-tight sm:text-3xl lg:mt-9 lg:text-4xl">
            Enterprise Telecalling CRM &amp; HR Management
          </h1>
          <p className="mt-3 max-w-md text-sm text-blue-100">
            Role-based console for Admin, HR, Managers and Telecalling Agents — 1M+ lead pipeline,
            server-side pagination at 500 leads/page, deal approvals, payouts and KYC.
          </p>
        </div>

        <ul className="hidden gap-3 text-sm lg:grid">
          {[
            "Mobile-first agent dialer with tel: + WhatsApp deep links",
            "Kanban & data table for 1,000,000 leads (500 per page)",
            "Approvals center: deals, payouts, corrections, lead requests",
            "Audit trail, automated cleanup cron and push broadcast",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-blue-50">
              <span className="mt-0.5 text-emerald-300">✔</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3 text-xs text-blue-50 lg:p-4">
            <p className="font-semibold uppercase tracking-wider">Demo password</p>
            <p className="mt-1 text-base font-mono font-bold text-white">password123</p>
          </div>
          <p className="text-[11px] font-medium tracking-wide text-blue-200">
            © {new Date().getFullYear()} Auto Growth Systems · All rights reserved.
          </p>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center p-5 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-[10px] font-black text-white">
              AGS
            </span>
            <h2 className="text-xl font-extrabold tracking-tight">Auto Growth Systems</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Sign in to continue to your workspace.</p>

          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in to Auto Growth Systems
            </Button>
          </form>

          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Auto Growth Systems · one-tap demo roles
            </p>
            <div className="mt-2 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("password123");
                    void signIn(d.email, "password123");
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition active:scale-[0.99] hover:border-blue-300 hover:bg-blue-50/50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <d.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{d.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{d.email} · {d.hint}</span>
                  </span>
                  <span className="text-muted-foreground">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
