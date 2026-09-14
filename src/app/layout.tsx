import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import "../components/auth/entry.css";
import Theme from "../components/layout/theme-provider";

const heading = Lexend({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-heading-src",
});

const body = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body-src",
});

export const metadata: Metadata = {
  title: "Assura — better note, less burden",
  description:
    "Complete your shift note, review the details, and keep your handover in one place.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/assura-logo.svg",
    shortcut: "/assura-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${heading.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Theme>{children}</Theme>
      </body>
    </html>
  );
}
