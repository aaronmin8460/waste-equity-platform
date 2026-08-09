# 여기다 (Yeogida) UI Redesign — Unsupported Requirements

Every requested UI concept that **cannot truthfully be implemented** against the
current authoritative data or API contract is recorded here, together with the
safe alternative that was used instead.

This file exists so that an unimplementable Figma surface is never silently
approximated, back-filled with a zero, or fabricated. It accumulates across all
seven phases.

Governing rules: [`YEOGIDA_UI_REDESIGN_SPEC.md`](YEOGIDA_UI_REDESIGN_SPEC.md)
§11 (absolute data-integrity rules) and the repository `AGENTS.md`.

---

## U1 — Exact Figma visual specification

**Requested UI concept:** Match the supplied Figma frames exactly — spacing
scale, type ramp, per-component measurements, icon artwork, elevation values,
and the explicit stable-candidate colour.

**Status:** UNSUPPORTED — source inaccessible. Implemented from the approved
written decisions instead.

**Why it cannot truthfully be implemented:** Both Figma files returned HTTP 403
/ a login wall from this environment, and no Figma MCP server is connected to
the session. There is no way to read the frames, so any claim of pixel fidelity
would be unverifiable.

**Existing source/API limitation:** Not a data limitation — a design-source
access limitation.

**Safe alternative used:** The approved brand/colour/typography/navigation
decisions recorded in the spec, applied through the repository's existing
semantic token system and documented design guidance
(`docs/UI_UX_DESKTOP_REDESIGN_PLAN.md`, `docs/ui-refresh/*`). Exact hex values,
the six destination names, the sidebar dimensions, and the A/B/C rule all come
from the written approval, not from guesswork.

**Future work if desired:** Re-run the visual QA phase with a Figma personal
access token or a connected Figma MCP server and diff the implemented screens
against the real frames.

---

## U2 — Figma stable-candidate accent colour

**Requested UI concept:** Use the explicit Figma stable-candidate colour for the
stable-candidate visual treatment.

**Status:** UNSUPPORTED — colour unverifiable. Documented fallback in use.

**Why it cannot truthfully be implemented:** See U1 — the Figma file cannot be
read, so the specific colour cannot be verified. The spec explicitly authorises
the fallback in this case.

**Existing source/API limitation:** None (presentation only).

**Safe alternative used:** The existing `#d81b60` stable-candidate distinction
already implemented in the repository is retained unchanged, and stability is
additionally carried as **text**, never colour alone.

**Future work if desired:** Swap the accent once the Figma value is readable.

---

## U3 — Figma sample data values

**Requested UI concept:** The numeric values shown in the Figma mock screens.

**Status:** DELIBERATELY NOT IMPLEMENTED (by rule, not by limitation).

**Why it cannot truthfully be implemented:** Figma sample numbers are visual
mock values. Spec §11.1 forbids hard-coding them as production data.

**Existing source/API limitation:** n/a.

**Safe alternative used:** Every displayed value comes from the backend API. A
value the API does not serve renders as the existing "자료 없음" / unavailable
state with its served reason — never as `0`.

**Future work if desired:** None. This is the correct permanent behaviour.

---

## U4 — Two pre-existing e2e failures inherited from `origin/main`

**Requested UI concept:** A fully green Playwright suite at the end of Phase 1.

**Status:** NOT MET — two failures pre-date this work. Not caused by, and not
fixable within, the global-shell phase.

**Why it cannot truthfully be implemented (here):** Both failures are in
`e2e/phase5LandfillDashboard.spec.ts` and both come from the municipal-cost
section merged in `063d977`:

- `the standing limitation is one compact info banner, not an alert` asserts
  exactly one `.wep-banner` across the whole dashboard, but
  `MunicipalCostSection` legitimately renders a second warning banner (the one
  that keeps the landfill fee and the municipal payment from being read as one
  cost — a data-integrity notice that must not be removed).
- `clears the previous filter's values before the new ones arrive` asserts the
  dashboard does not contain `2024년` mid-flight, but the municipal heading is
  `시·군·구별 생활폐기물 수집·운반 계약 지급액 — 2024년`, a different dataset that
  the landfill period filter does not scope.

**Existing source/API limitation:** None — this is a test-scoping question, not
a data one. Both assertions were written when the landfill dashboard held one
dataset and now over-reach across two.

**Verification:** reproduced identically on a detached `origin/main` worktree
(`aece252`) with an independent `npm ci` and dev server.

**Safe alternative used:** None applied. Deliberately left for Phase 5, which
owns Page 2 — the correct fix is to scope both assertions to the landfill
section, and that decision belongs with the Page 2 information architecture.
Weakening or deleting them from the shell phase would remove a real contract.

**Future work if desired:** Fix in Phase 5 by scoping both locators to the
official-landfill section rather than the whole dashboard.

---

_Phase 2–7 entries are appended below as they are found._
