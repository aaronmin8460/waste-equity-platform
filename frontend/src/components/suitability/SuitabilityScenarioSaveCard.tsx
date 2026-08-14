"use client";

/**
 * ④ 시나리오 저장 + 저장목록 보기 (Figma 136:8684 card ④, list 231:442, row menu
 * 231:475).
 *
 * ── WHAT IT SAVES ────────────────────────────────────────────────────────────────
 * The Z/R/E/D weights CURRENTLY IN FORCE on 후보지 심층 분석 — that is, the served
 * weights of the active 점수 반영 기준 (② 계산 모델 가중치 설정) — together with the
 * run they belong to. Nothing is invented: when the run served no weights for the
 * active basis, this card says so and the save button is unavailable, rather than
 * saving a zero or an assumed default.
 *
 * Figma populates the list with three mock rows (시나리오 03 / 시나리오 02 /
 * 균형 중심안, each with a mock four-factor weight line whose factor names are not
 * this backend's). None of that is rendered. The list shows only what the reader
 * actually saved, and the weight line uses the repository's own four components
 * via `namedWeights`, so the saved row and the ② card can never disagree.
 *
 * ── WHAT THE SAVE BUTTON ACTUALLY DOES ───────────────────────────────────────────
 * It does NOT write to storage directly. The page runs the weights through
 * `POST /suitability/scenarios/preview` first and persists the SERVER's
 * `canonical_weights` and `run_id`, so a stored scenario is one the analysis
 * engine has already accepted for that run. This component owns the form and the
 * list; every decision about validity belongs upstream of it.
 *
 * ── THE ⋮ MENU ───────────────────────────────────────────────────────────────────
 * Figma shows a `⋮` opening 이름 변경 / 삭제. There is no menu primitive in this
 * repository (no `role="menu"` exists anywhere), and inventing a full menu widget —
 * roving tabindex, focus trap, Escape handling — for two actions would be more
 * surface than the feature. The `⋮` is therefore a plain `aria-expanded` disclosure
 * over the same two buttons: identical shape on screen, ordinary Tab semantics, no
 * new interaction model to get wrong.
 *
 * 삭제 is two-step. A saved scenario is work the reader chose to keep and there is
 * no undo, so a single stray click must not destroy it.
 */

import { useId, useState } from "react";

import type { UserScenarioWeights } from "../../lib/api";
import { namedWeights } from "../../lib/suitability";
import {
  SAVED_SCENARIO_CAP,
  SAVED_SCENARIO_NAME_MAX_LENGTH,
  SAVED_SCENARIO_OTHER_RUN_NOTICE,
  SAVED_SCENARIO_STORAGE_NOTICE,
  scenarioNameLength,
  scenarioNameProblem,
  scenarioRunState,
  type ComparisonResolution,
  type ComparisonSlot,
  type SavedScenario,
} from "../../lib/savedScenarios";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";

export interface SuitabilityScenarioSaveCardProps {
  /**
   * The active basis' SERVED weights, or null when the run served none for it.
   * Never a fallback vector — an absent weight set disables saving and says why.
   */
  weights: UserScenarioWeights | null;
  /** Citizen-facing name of the basis those weights came from ("기본 가정", …). */
  weightsSourceLabel: string;
  /** The run on screen. `null` while it is still loading. */
  activeRunId: number | null;
  scenarios: readonly SavedScenario[];
  /** Plain-Korean notes about stored entries that could not be read. */
  storageWarnings: readonly string[];
  /** In-flight preview validation for the pending save. */
  saving: boolean;
  /** Last write failure (storage or preview), already citizen-facing. */
  error: string | null;
  /** Last successful write, for the confirmation line. */
  notice: string | null;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** ⑤'s current A/B resolution, so a row can show and change its slot. */
  selection: ComparisonResolution;
  onAssignSlot: (slot: ComparisonSlot, id: string) => void;
  onClearSlot: (slot: ComparisonSlot) => void;
}

/** `2026-01-01` in the reader's locale. Empty string for an unparseable value. */
function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function SuitabilityScenarioSaveCard({
  weights,
  weightsSourceLabel,
  activeRunId,
  scenarios,
  storageWarnings,
  saving,
  error,
  notice,
  onSave,
  onRename,
  onDelete,
  selection,
  onAssignSlot,
  onClearSlot,
}: SuitabilityScenarioSaveCardProps) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const nameLength = scenarioNameLength(name);
  const nameProblem = scenarioNameProblem(name);
  const tooLong = nameProblem === "INVALID_NAME_TOO_LONG";
  const atCap = scenarios.length >= SAVED_SCENARIO_CAP;
  // Four independent reasons a save cannot proceed, each stated below rather than
  // left for the reader to infer from a greyed-out button.
  const canSave = weights !== null && activeRunId !== null && nameProblem === null && !atCap && !saving;

  const renameProblem = renamingId === null ? null : scenarioNameProblem(renameDraft);

  const resetForm = () => setName("");

  const submitSave = () => {
    if (!canSave) return;
    onSave(name);
    resetForm();
  };

  const startRename = (scenario: SavedScenario) => {
    setRenamingId(scenario.id);
    setRenameDraft(scenario.name);
    setOpenMenuId(null);
    setConfirmDeleteId(null);
  };

  const submitRename = () => {
    if (renamingId === null || renameProblem !== null) return;
    onRename(renamingId, renameDraft);
    setRenamingId(null);
    setRenameDraft("");
  };

  return (
    <SectionCard
      title="④ 시나리오 저장"
      testId="scenario-save"
      className="wep-figma-card wep-numbered-card"
    >
      {/* WHAT is about to be saved, before the name field asks for a label for it.
          A name box with no visible subject is a box a reader has to guess at. */}
      {weights === null ? (
        <InfoBanner tone="warning" testId="scenario-save-no-weights">
          <p>
            현재 점수 반영 기준({weightsSourceLabel})의 가중치를 이 분석 실행에서 확인할 수 없어
            시나리오를 저장할 수 없습니다.
          </p>
        </InfoBanner>
      ) : (
        // The label already carries its own noun (`profileLabel` returns e.g.
        // "기본 기준"), so the sentence must not append another one.
        <p className="text-[10px] leading-snug text-ink-subtle" data-testid="scenario-save-weights">
          <span className="font-medium text-ink">{weightsSourceLabel}</span>의 가중치를 저장합니다 ·{" "}
          {namedWeights(weights)}
        </p>
      )}

      <div className="mt-3">
        <label className="text-[12.5px] font-bold text-ink" htmlFor={nameId}>
          시나리오 이름
        </label>
        {/* Figma 136:8684 puts the counter INSIDE the field, right-aligned, so the
            field spans the card instead of giving a quarter of its width to a
            three-character count. The counter is still a separate element with its
            own id, so `aria-describedby` on the input is unchanged. */}
        <div className="mt-1.5 flex h-[39px] items-center gap-2 rounded-control border border-hairline-strong bg-surface pl-3.5 pr-3 focus-within:border-primary-border">
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitSave();
              }
            }}
            placeholder="예: 형평성 우선안"
            // No `maxLength`: it counts UTF-16 units, so a 15-character limit would
            // silently become 7 for a reader typing emoji. The limit is enforced on
            // CODE POINTS below, and the counter shows the same number the rule uses.
            aria-describedby={`${nameId}-counter`}
            aria-invalid={tooLong || undefined}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-subtle"
            data-testid="scenario-name-input"
          />
          <span
            id={`${nameId}-counter`}
            className={`flex-none text-[11px] tabular-nums ${tooLong ? "font-semibold text-warn" : "text-ink-subtle"}`}
            data-testid="scenario-name-counter"
          >
            {nameLength}/{SAVED_SCENARIO_NAME_MAX_LENGTH}
          </span>
        </div>
      </div>

      {/* Two EQUAL 41px actions, the Figma pair: a quiet 취소 and the navy
          시나리오 저장. Equal width because neither is a secondary afterthought —
          one abandons the draft, the other commits it. */}
      <div className="mt-2.5 flex items-stretch gap-2.5">
        <button
          type="button"
          onClick={resetForm}
          className="h-[41px] flex-1 rounded-[12px] border border-hairline-strong bg-surface text-sm font-bold text-ink hover:bg-surface-muted"
          data-testid="scenario-save-cancel"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submitSave}
          disabled={!canSave}
          className="h-[41px] flex-1 rounded-[12px] bg-primary text-sm font-bold text-primary-ink hover:bg-primary-hover disabled:opacity-40"
          data-testid="scenario-save-submit"
        >
          {saving ? "확인 중…" : "시나리오 저장"}
        </button>
      </div>

      {/* Why the button is unavailable, in words. Order matters: the cap is the one
          the reader can act on, so it is stated even while the name is still empty. */}
      {atCap && (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-save-cap">
          저장할 수 있는 시나리오는 최대 {SAVED_SCENARIO_CAP}개입니다. 아래 목록에서 하나를 삭제한 뒤
          저장해 주세요.
        </p>
      )}
      {tooLong && (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-name-too-long">
          시나리오 이름은 {SAVED_SCENARIO_NAME_MAX_LENGTH}자 이내로 입력해 주세요.
        </p>
      )}

      {error && (
        <div className="mt-2">
          <InfoBanner tone="error" role="alert" testId="scenario-save-error">
            <p>{error}</p>
          </InfoBanner>
        </div>
      )}
      {notice && !error && (
        <p className="mt-1 text-[11px] text-ink-muted" role="status" data-testid="scenario-save-notice">
          {notice}
        </p>
      )}

      {/* The storage scope, stated where the reader saves — not in a footnote at the
          bottom of the page they may never reach. */}
      <p className="mt-2 text-[10px] leading-snug text-ink-subtle" data-testid="scenario-storage-notice">
        {SAVED_SCENARIO_STORAGE_NOTICE}
      </p>

      {storageWarnings.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5" data-testid="scenario-storage-warnings">
          {storageWarnings.map((warning) => (
            <li key={warning} className="text-[10px] leading-snug text-warn">
              {warning}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-2" data-testid="scenario-saved-list-disclosure">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted">
          저장목록 보기 ({scenarios.length}개)
        </summary>

        {scenarios.length === 0 ? (
          <p className="mt-1 text-[11px] leading-snug text-ink-muted" data-testid="scenario-saved-empty">
            저장한 시나리오가 없습니다. 위에서 이름을 입력하고 저장하면 이곳에 표시됩니다.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1" data-testid="scenario-saved-list">
            {scenarios.map((scenario) => {
              const runState = scenarioRunState(scenario, activeRunId);
              const otherRun = runState === "OTHER_RUN";
              const isA = selection.a.id === scenario.id;
              const isB = selection.b.id === scenario.id;
              const menuOpen = openMenuId === scenario.id;
              const renaming = renamingId === scenario.id;
              const savedAt = formatSavedAt(scenario.updatedAt);

              return (
                <li
                  key={scenario.id}
                  className="rounded-card border border-hairline bg-surface px-2 py-1.5"
                  data-testid="scenario-saved-item"
                  data-scenario-id={scenario.id}
                >
                  {renaming ? (
                    <div className="flex flex-col gap-1" data-testid="scenario-rename-form">
                      <div className="flex items-center gap-2">
                        <input
                          id={`${nameId}-rename`}
                          type="text"
                          // Named by an attribute rather than an `sr-only` <label>,
                          // for the layout reason documented on `SlotButton` below.
                          aria-label="시나리오 이름 변경"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              submitRename();
                            }
                          }}
                          aria-invalid={renameProblem !== null || undefined}
                          className="min-w-0 flex-1 rounded-card border border-hairline bg-surface px-2 py-1 text-xs text-ink"
                          data-testid="scenario-rename-input"
                        />
                        <span className="flex-none text-[11px] tabular-nums text-ink-subtle">
                          {scenarioNameLength(renameDraft)}/{SAVED_SCENARIO_NAME_MAX_LENGTH}
                        </span>
                      </div>
                      {renameProblem !== null && (
                        <p className="text-[10px] text-warn" data-testid="scenario-rename-problem">
                          {renameProblem === "INVALID_NAME_EMPTY"
                            ? "시나리오 이름을 입력해 주세요."
                            : `시나리오 이름은 ${SAVED_SCENARIO_NAME_MAX_LENGTH}자 이내로 입력해 주세요.`}
                        </p>
                      )}
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={submitRename}
                          disabled={renameProblem !== null}
                          className="wep-btn-quiet min-h-[28px] px-2 text-[11px] disabled:opacity-40"
                          data-testid="scenario-rename-confirm"
                        >
                          이름 저장
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="wep-btn-quiet min-h-[28px] px-2 text-[11px]"
                          data-testid="scenario-rename-cancel"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" data-testid="scenario-saved-name">
                          {scenario.name}
                        </span>
                        <button
                          type="button"
                          aria-expanded={menuOpen}
                          aria-label={`${scenario.name} 관리`}
                          onClick={() => {
                            setOpenMenuId(menuOpen ? null : scenario.id);
                            setConfirmDeleteId(null);
                          }}
                          className="flex-none rounded-card border border-hairline px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface-muted"
                          data-testid="scenario-saved-menu-toggle"
                        >
                          <span aria-hidden="true">⋮</span>
                        </button>
                      </div>

                      <p className="mt-0.5 text-[10px] leading-snug text-ink-muted" data-testid="scenario-saved-weights">
                        {namedWeights(scenario.weights)}
                      </p>

                      <p className="mt-0.5 text-[10px] text-ink-subtle">
                        {savedAt && (
                          <time dateTime={scenario.updatedAt} data-testid="scenario-saved-at">
                            {savedAt} 저장
                          </time>
                        )}
                        {scenario.profileSource && (
                          <span data-testid="scenario-saved-source"> · {scenario.profileSource} 기준</span>
                        )}
                      </p>

                      {/* Run compatibility, stated on the row. An OTHER_RUN scenario
                          is still the reader's — it is shown in full — but it cannot
                          enter an A/B comparison until it is re-verified, because its
                          weights were checked against a different frozen run. */}
                      {otherRun && (
                        <p
                          className="mt-1 rounded-card bg-surface-muted px-1.5 py-1 text-[10px] leading-snug text-warn"
                          data-testid="scenario-saved-other-run"
                        >
                          {SAVED_SCENARIO_OTHER_RUN_NOTICE}
                        </p>
                      )}

                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <SlotButton
                          slot="A"
                          active={isA}
                          disabled={otherRun}
                          scenarioName={scenario.name}
                          onSelect={() => (isA ? onClearSlot("A") : onAssignSlot("A", scenario.id))}
                        />
                        <SlotButton
                          slot="B"
                          active={isB}
                          disabled={otherRun}
                          scenarioName={scenario.name}
                          onSelect={() => (isB ? onClearSlot("B") : onAssignSlot("B", scenario.id))}
                        />
                      </div>

                      {menuOpen && (
                        <div className="mt-1 flex flex-wrap gap-1" data-testid="scenario-saved-menu">
                          <button
                            type="button"
                            onClick={() => startRename(scenario)}
                            className="wep-btn-quiet min-h-[28px] px-2 text-[11px]"
                            data-testid="scenario-rename-open"
                          >
                            이름 변경
                          </button>
                          {confirmDeleteId === scenario.id ? (
                            <>
                              <span className="self-center text-[10px] text-warn" data-testid="scenario-delete-confirm-prompt">
                                삭제하면 되돌릴 수 없습니다.
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onDelete(scenario.id);
                                  setConfirmDeleteId(null);
                                  setOpenMenuId(null);
                                }}
                                className="wep-btn-quiet min-h-[28px] px-2 text-[11px] font-semibold text-warn"
                                data-testid="scenario-delete-confirm"
                              >
                                삭제 확인
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="wep-btn-quiet min-h-[28px] px-2 text-[11px]"
                                data-testid="scenario-delete-cancel"
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(scenario.id)}
                              className="wep-btn-quiet min-h-[28px] px-2 text-[11px]"
                              data-testid="scenario-delete-open"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </SectionCard>
  );
}

/**
 * One A/B assignment toggle. `aria-pressed` carries the state, and the accessible
 * name always contains the scenario, so a screen-reader user hears which scenario
 * a slot button belongs to rather than a wall of identical "A안" buttons.
 */
function SlotButton({
  slot,
  active,
  disabled,
  scenarioName,
  onSelect,
}: {
  slot: ComparisonSlot;
  active: boolean;
  disabled: boolean;
  scenarioName: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      title={
        disabled
          ? "다른 분석 실행에서 저장된 시나리오는 현재 실행과 비교할 수 없습니다."
          : undefined
      }
      // The scenario's name reaches the accessible name through an ATTRIBUTE, not
      // an `sr-only` child: `.sr-only` is `position: absolute` and would resolve
      // against the initial containing block, escaping the scrolling `.wep-panel`
      // and giving the whole page a vertical scrollbar
      // (e2e/suitabilityDashboard.spec.ts asserts there is none).
      aria-label={`${scenarioName}을(를) ${slot}안으로 ${active ? "선택 해제" : "선택"}`}
      className={`rounded-full border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-primary-border bg-primary-soft font-semibold text-ink"
          : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
      }`}
      data-testid={`scenario-slot-${slot.toLowerCase()}`}
    >
      <span aria-hidden="true">{slot}안</span>
    </button>
  );
}
