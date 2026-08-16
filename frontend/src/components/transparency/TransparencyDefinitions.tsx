"use client";

/**
 * 공통 해석 기준 — the canonical home for every rule that applies to more than one
 * screen.
 *
 * ── WHAT THIS SECTION REPLACED ─────────────────────────────────────────────────
 * The audit found six global rules written out three or four times each across this
 * one screen: missing-is-not-zero, reported-versus-derived, a failed lookup versus
 * an absent reference period, differing reference periods, differing accounting
 * bases, and "a cost figure is not a total project cost". They sat in the standing
 * banner, in an overview tile caption, in two gap blocks, in a methodology
 * disclosure, and on the dataset table's footnote at the same time.
 *
 * Each of them is now stated ONCE. The other surfaces keep only what is genuinely
 * theirs: the stateful badge (`ui/DataStatusBadge`) where a specific record is
 * missing a specific value, and a record-specific sentence where the fact really is
 * about that record.
 *
 * ── WHY SOME OF IT IS VISIBLE AND SOME IS A DISCLOSURE ─────────────────────────
 * The cross-screen interpretation rules are VISIBLE: several of them arrive here
 * from Pages 1–3, which are removing the repeated copies from their primary
 * surfaces, and a rule that only exists behind a collapsed summary would have been
 * deleted rather than relocated.
 *
 * The label glossary (표시 용어 안내) stays a native `<details>`. It is a lookup
 * table for badge wording a reader consults after meeting a badge — not a rule they
 * need before reading the screen — and it is the same disclosure that has always
 * been this screen's home for that content, moved here so all the definitions live
 * in one section.
 *
 * ── WHAT IS NOT HERE ───────────────────────────────────────────────────────────
 * No weight, threshold, distance floor, numerator, direction, or stability rule for
 * any future screening version. `SUCCESSOR_METHODOLOGY_SLOT` states that the next
 * methodology is unfinished and documents nothing else, because a transparency
 * screen that guessed at an unmade decision would be doing the exact thing it exists
 * to prevent.
 */

import Accordion from "../ui/Accordion";
import {
  ANALYSIS_DEFINITIONS,
  COMPARISON_DEFINITIONS,
  SUCCESSOR_METHODOLOGY_SLOT,
  type GlobalDefinition,
} from "./shared";

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-ink">{children}</h3>;
}

/**
 * One group of definitions.
 *
 * A real `<dl>`: the term is the thing a reader met on another screen, the meaning
 * is the one sentence that says what it is and what it is not. The term is never
 * collapsed into the sentence, so a reader scanning for 지도 색 구간 finds it without
 * reading six paragraphs.
 */
function DefinitionGroup({
  title,
  definitions,
  testId,
}: {
  title: string;
  definitions: readonly (GlobalDefinition & { testId?: string })[];
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <GroupHeading>{title}</GroupHeading>
      <dl className="mt-2 flex flex-col gap-2.5">
        {definitions.map((definition) => (
          <div key={definition.term} data-testid={definition.testId}>
            <dt className="text-sm font-medium text-ink">{definition.term}</dt>
            <dd className="mt-0.5 text-sm leading-snug text-ink-muted">{definition.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function TransparencyDefinitions() {
  return (
    <div className="flex flex-col gap-4">
      {/* Two columns from `lg`, so the eleven rules read as a compact reference
          rather than one long scroll. Bare on the modal surface, like every other
          section here — Page 6 reserves a bordered surface for the overview tiles
          and the source cards, and adds no shadowed card system of its own. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
        <DefinitionGroup
          title="서로 다른 자료를 함께 볼 때"
          definitions={COMPARISON_DEFINITIONS}
          testId="transparency-def-comparison"
        />
        <DefinitionGroup
          title="이 서비스가 계산한 값을 읽을 때"
          definitions={ANALYSIS_DEFINITIONS}
          testId="transparency-def-analysis"
        />
      </div>

      {/* The label glossary. Kept as the disclosure it has always been, and kept as
          the ONLY place these six labels are defined — the banner, the overview
          captions and the gap blocks no longer restate them. */}
      <Accordion label="표시 용어 안내 (상태 표시의 뜻)" testId="transparency-status-guide">
        <dl className="flex flex-col gap-2 text-sm text-ink-muted">
          <div>
            <dt className="font-medium text-ink">직접 보고값</dt>
            <dd>출처 기관이 그 값을 그대로 보고한 경우입니다.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">공식 자료 기반 계산값</dt>
            <dd>
              이 서비스가 공식 자료 두 가지 이상을 이용해 계산한 값이며, 기관이 발표한 공식 통계가
              아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">자료 없음</dt>
            <dd>
              값을 제공받지 못했다는 뜻입니다. 값이 0이라는 뜻이 아니며, 빈 칸을 0으로 채우지
              않습니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">기준 기간 정보 없음</dt>
            <dd>
              그 출처의 기준 기간을 함께 받지 못했다는 뜻입니다. 자료가 없다는 뜻도, 값이 0이라는
              뜻도 아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">기준 기간을 불러오지 못했습니다</dt>
            <dd>
              기준 기간을 확인하는 요청 자체가 실패한 경우입니다. 기준 기간이 없는 것과는 다른
              상태입니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">수집 시점</dt>
            <dd>
              이 서비스가 그 자료를 마지막으로 성공적으로 받아온 시각(세계표준시)입니다. 그 자료가
              현재 시점의 값이라는 뜻은 아닙니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">사용 안 함</dt>
            <dd>목록에는 등록되어 있으나 현재 이 서비스가 사용하지 않는 출처입니다.</dd>
          </div>
        </dl>
      </Accordion>

      {/* The structural slot for the next screening methodology. It documents an
          ABSENCE and nothing else: no weight, no threshold, no rule. */}
      <div
        className="rounded-2xl border border-hairline bg-surface-muted p-4"
        data-testid="transparency-def-successor"
      >
        <GroupHeading>{SUCCESSOR_METHODOLOGY_SLOT.title}</GroupHeading>
        <p className="mt-1 text-sm leading-snug text-ink-muted">
          {SUCCESSOR_METHODOLOGY_SLOT.body}
        </p>
      </div>
    </div>
  );
}
