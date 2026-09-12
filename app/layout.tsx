import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LegalMate — Shift notes",
  description:
    "Complete your shift note, review the details, and keep your handover in one place.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
