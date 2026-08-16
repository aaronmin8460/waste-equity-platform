import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";

import { BRAND_NAME, BRAND_SUBTITLE } from "../lib/glossary";
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
 * ── The requested weight set (corrected by the Figma forensic audit) ─────────────
 * Only weights the UI actually uses are requested, because each weight of a CJK
 * face is a large download. The audit found the set had drifted from the UI in both
 * directions:
 *
 *   - 600 was MISSING while `font-semibold` is used 132 times in the components and
 *     `font-weight: 600` five more times in globals.css. With no 600 face loaded the
 *     browser fell back to the nearest available weight or a synthesised one, so the
 *     single most common emphasis level in the app was never the designed one.
 *   - 800 was loaded and used NOWHERE — no `font-extrabold`, no `font-weight: 800`.
 *     The brand wordmark the docblock claimed it for renders at 700
 *     (`.wep-brand-name`).
 *
 * Swapping 800 for 600 is therefore the whole fix: the same number of downloads, and
 * every weight the UI asks for is now a real face. `app/layout.test.tsx` pins the set
 * against the weights the source actually uses, so the two cannot drift again.
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The document title is the brand block's two strings joined, so the browser tab,
 * the app bar, and the narrow-screen gate all name the product the same way. The
 * subtitle half is `BRAND_SUBTITLE` verbatim — imported rather than retyped, so the
 * tab can never drift from the header (`app/layout.test.tsx` pins the relationship).
 */
export const metadata: Metadata = {
  title: `${BRAND_NAME} — ${BRAND_SUBTITLE}`,
  description:
    "서울·인천·경기 공공자료로 폐기물 처리시설 후보지를 비교하는 시민용 분석 플랫폼입니다.",
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
