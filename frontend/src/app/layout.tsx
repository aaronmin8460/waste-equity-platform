import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "수도권 폐기물 형평성 지도 — Waste Equity Platform",
  description:
    "Official-data policy map for waste-management equity across Seoul, Incheon, and Gyeonggi-do.",
};

// Explicit responsive viewport so phones render at device width (not the ~980px
// desktop fallback). `initialScale: 1` with the default `userScalable` left on
// keeps pinch-zoom available for accessibility — we never disable it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* min-h-dvh (dynamic viewport) so the app fills the visible area even as
          mobile browser toolbars expand/collapse, instead of the static 100%.
          `min-h-screen` precedes it as a static-viewport fallback: engines without
          `dvh` support drop the invalid `min-height:100dvh` and keep `100vh`. */}
      <body className="min-h-screen min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
