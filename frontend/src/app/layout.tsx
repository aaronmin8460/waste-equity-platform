import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

/**
 * The 여기다 Korean UI face (docs/YEOGIDA_UI_REDESIGN_SPEC.md §1).
 *
 * `next/font/google` downloads and SELF-HOSTS the files at build time, so the
 * running app makes no request to fonts.googleapis.com — which matters here
 * because production serves behind Caddy with a restrictive origin policy.
 * `display: "swap"` keeps text readable while the Korean subset (the large one)
 * is still arriving; the fallback chain lives in the `--font-sans` token in
 * globals.css.
 *
 * Only weights the UI actually uses are requested — 400 body, 500/700 emphasis,
 * 800 for the brand wordmark — because each weight of a CJK face is a large
 * download.
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "여기다 — 쓰레기 매립지 입지 추천 플랫폼",
  description:
    "서울·인천·경기 공공자료로 쓰레기 매립지 후보지를 비교하는 시민용 분석 플랫폼입니다.",
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
    // The application content is primarily Korean, so the document language is
    // `ko`: assistive technology then reads Korean text with the correct voice
    // and pronunciation rules instead of an English one.
    <html
      lang="ko"
      className={`${notoSansKr.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* min-h-dvh (dynamic viewport) so the app fills the visible area even as
          mobile browser toolbars expand/collapse, instead of the static 100%.
          `min-h-screen` precedes it as a static-viewport fallback: engines without
          `dvh` support drop the invalid `min-height:100dvh` and keep `100vh`. */}
      <body className="min-h-screen min-h-dvh flex flex-col">
        {/* Skip link: the first focusable element in the tab order, visually
            hidden until it receives keyboard focus (see globals.css .skip-link).
            Activating it moves focus to the primary <main> content region, which
            carries id="main-content" tabindex="-1" in every rendered view, so a
            keyboard or screen-reader user can bypass the repeated controls. */}
        <a href="#main-content" className="skip-link">
          본문으로 바로가기
        </a>
        {children}
      </body>
    </html>
  );
}
