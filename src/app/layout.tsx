import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Growth Systems — Telecalling CRM & HR Suite",
  description:
    "Auto Growth Systems — enterprise telecalling CRM and HR suite with RBAC, a 1M-lead pipeline, approvals, payouts and KYC.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* restore the saved palette before first paint (Day / Dark / Grown) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ags-theme")||"day";if(t!=="day"&&t!=="dark"&&t!=="grown")t="day";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="day";}`,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
