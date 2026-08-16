"use client";

/**
 * The standing "how to read this screen" notice.
 *
 * Deliberately NOT `role="alert"`: this is information that is never new, and an
 * alert would interrupt a screen reader on every render (see
 * `components/ui/InfoBanner.tsx`). It is also the ONLY banner on a successful
 * transparency screen — a permanent caveat repeated in a second coloured panel stops
 * being read.
 *
 * `tone="info"` rather than `tone="warning"`: nothing here cautions about a value
 * that exists.
 *
 * ── IT IS A SIGNPOST, NOT A SECOND RULEBOOK ────────────────────────────────────
 * This banner used to spell out four global rules — differing reference periods,
 * missing-is-not-zero, reported-versus-derived, and the catalog's scope — every one
 * of which was ALSO written out further down the same screen, two or three more
 * times each. What survives here is the single rule a reader needs before they read
 * anything (a blank is not a zero), the one fact that is genuinely about the catalog
 * directly below it (it is not every public dataset), and a pointer to the one
 * section where the rest are defined. Everything else moved to `공통 해석 기준`
 * (`TransparencyDefinitions`).
 */

import InfoBanner from "../ui/InfoBanner";

export default function TransparencyNotice() {
  return (
    <InfoBanner tone="info" title="이 화면을 읽는 방법" testId="transparency-notice">
      <p>
        분석 결과는 아래에 적힌 공식 자료와 그 기준 기간에 따라 달라집니다. 제공되지 않는 값은 0이
        아니라 &lsquo;자료 없음&rsquo;으로 표시합니다.
      </p>
      <p className="mt-1 text-xs">
        아래 목록은 이 서비스가 현재 연계한 자료이며, 관련 공공자료 전체를 담고 있다는 뜻은
        아닙니다. 화면 전체에 함께 적용되는 표시·비교 기준은 아래 &lsquo;공통 해석 기준&rsquo;에 한
        번만 정리했습니다.
      </p>
    </InfoBanner>
  );
}
