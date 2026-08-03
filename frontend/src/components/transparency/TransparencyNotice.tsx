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
 * that exists. It states the three reading rules the rest of the page applies.
 */

import InfoBanner from "../ui/InfoBanner";

export default function TransparencyNotice() {
  return (
    <InfoBanner tone="info" title="이 화면을 읽는 방법" testId="transparency-notice">
      <p>
        분석 결과는 아래에 적힌 공식 자료와 그 기준 기간에 따라 달라집니다. 자료마다 기준 기간이 서로
        다르므로 서로 다른 기간의 값을 그대로 비교할 수 없습니다.
      </p>
      <p className="mt-1 text-xs">
        제공되지 않는 값은 0이 아니라 &lsquo;자료 없음&rsquo;으로 표시하며, 기관이 직접 보고한 값과
        이 서비스가 공식 자료로 계산한 값을 구분해 표시합니다. 아래 목록은 이 서비스가 현재 연계한
        자료이며, 관련 공공자료 전체를 담고 있다는 뜻은 아닙니다.
      </p>
    </InfoBanner>
  );
}
