/**
 * 시·군·구 단위 묶어 보기 — a PRESENTATION grouping of Page-5's candidate rows.
 *
 * ── THE REQUIREMENT ──────────────────────────────────────────────────────────────
 * The comparison surfaces used to render one long flat list in which the same
 * 시·군·구 name was reprinted on every row:
 *
 *     인천광역시 옹진군 / 인천광역시 옹진군 / 인천광역시 옹진군 / … / 인천광역시 강화군
 *
 * The owner requires the 시·군·구 to become the visual GROUPING KEY instead, stated
 * once as a heading, with the candidate cells listed under it:
 *
 *     [옹진군]  후보 A · 후보 B · 후보 C
 *     [강화군]  후보 D · 후보 E
 *
 * Figma agrees: `359:1384` asks for "[가중치 민감도 (결과 안정성)]에 군 단위로 합치기"
 * and complains about the same flat list ("네모칸 안에 쫘르륵 리스트업 되어 있는 형식
 * 말고").
 *
 * ── ⛔ WHAT THIS MODULE MUST NEVER DO — AND DOES NOT ─────────────────────────────
 * The owner explicitly REJECTED aggregating municipalities. The Figma sheet
 * `167-11235` illustrates the roll-up with "안산시: 평균 순위 2위 / 변동폭 2" — a
 * per-시·군·구 AVERAGE RANK — and that illustration is deliberately NOT implemented.
 * By the standing priority order (owner's explicit requirement > Figma annotation >
 * Figma visual), the owner's rule wins.
 *
 * So this module computes, for a group:
 *
 *   - NO average score, NO median score, NO synthetic 시·군·구 score;
 *   - NO average rank, NO median rank, NO synthetic group rank, NO group 변동폭;
 *   - NO ordering key derived by aggregating the members' numbers.
 *
 * The ONLY group-level number it produces is `size`, a COUNT of rows — which is not
 * a measurement of the 시·군·구, merely how many rows are printed beneath the
 * heading. Every rank, score, movement and variability band stays exactly where it
 * was measured: on the individual candidate row. A 시·군·구 remains a place that
 * candidate cells lie in, never a scored object.
 *
 * `sizeOf` is deliberately the only reducer in this file, and
 * `scenarioSigunguGroups.test.ts` asserts that a group carries no numeric field
 * other than that count, so a future edit cannot quietly add one.
 *
 * ── ORDERING ─────────────────────────────────────────────────────────────────────
 * Groups appear in the order their FIRST member appears in the incoming row array,
 * and members keep their incoming order within a group. That means the caller's sort
 * still decides everything: sorting by B안 순위 puts the 시·군·구 holding the best
 * candidate first, because that candidate is first. No group is reordered by a
 * quantity computed here, because no such quantity is computed here.
 */

/** The minimum a row must carry to be grouped. Structurally satisfied by
 *  `RankedCandidateRow`, but stated narrowly so this module cannot reach for a rank. */
export interface SigunguGroupable {
  /** The backend's fully-qualified 시·군·구 name ("인천광역시 옹진군"), or null. */
  sigunguName: string | null;
  /** The 시·도 name, used only when the 시·군·구 is unassigned. */
  sidoName: string | null;
}

export interface SigunguGroup<Row extends SigunguGroupable> {
  /**
   * Stable identity for React keys and test selectors. The served name, or the
   * explicit unassigned sentinel — never a fabricated place.
   */
  key: string;
  /**
   * The heading as printed: the SHORT 시·군·구 name where the 시·도 prefix is
   * redundant under the group heading, e.g. "옹진군" from "인천광역시 옹진군".
   */
  label: string;
  /**
   * The 시·도 the heading belongs to, shown as the heading's quiet second half so
   * broad context survives without being reprinted on every row. `null` when the
   * served name carried no recognisable 시·도 prefix.
   */
  sidoLabel: string | null;
  /** The rows, in their incoming order. Every analytical value lives HERE. */
  rows: Row[];
  /**
   * How many rows are printed under this heading.
   *
   * A COUNT OF ROWS, NOT A MEASUREMENT OF THE 시·군·구. It is not a score, not a
   * rank, and it is never compared between groups as though it ranked them.
   */
  size: number;
}

/** The heading for rows whose 시·군·구 the backend did not assign. */
export const UNASSIGNED_SIGUNGU_KEY = "__unassigned__";
export const UNASSIGNED_SIGUNGU_LABEL = "지역 미배정";

/**
 * The 시·도 names that can prefix a served 시·군·구 name in this product's scope.
 *
 * The capital region only, because that is the whole analysed population. Splitting
 * on a fixed list rather than on whitespace is deliberate: "인천광역시 옹진군" splits
 * correctly, and so does a two-token 시·군·구 name that whitespace splitting would
 * mangle.
 */
const SIDO_PREFIXES: readonly string[] = ["서울특별시", "인천광역시", "경기도"];

/**
 * Split a served, fully-qualified name into its 시·도 and 시·군·구 halves.
 *
 * The backend serves `sigungu_region_name` ALREADY qualified ("인천광역시 강화군"),
 * which is why every other surface in this product prints that one field and never
 * prepends the 시·도 (see `locationLabelOf` in `lib/scenarioRankingComparison.ts`).
 * A group heading is the one place the two halves are wanted separately, so they are
 * split here rather than re-joined elsewhere. A name that does not start with a
 * known 시·도 is returned whole as the 시·군·구, never truncated or guessed at.
 */
export function splitQualifiedRegionName(name: string): {
  sido: string | null;
  sigungu: string;
} {
  const trimmed = name.trim();
  for (const sido of SIDO_PREFIXES) {
    if (trimmed.startsWith(sido)) {
      const rest = trimmed.slice(sido.length).trim();
      // A bare 시·도 with nothing after it is its own label, not an empty 시·군·구.
      if (rest === "") return { sido: null, sigungu: trimmed };
      return { sido, sigungu: rest };
    }
  }
  return { sido: null, sigungu: trimmed };
}

/** How many rows a group holds. THE ONLY reducer in this module — see the header. */
function sizeOf<Row>(rows: readonly Row[]): number {
  return rows.length;
}

/**
 * The 시·군·구 name this row is filed under, or `null` when it carries no place.
 *
 * The 시·군·구 first, the 시·도 as the fallback for a partly located cell — the rule
 * every grouped surface on Page 5 shares. Extracted so {@link groupRowsBySigungu}
 * and {@link selectSigunguRepresentatives} cannot drift into two different ideas of
 * what one municipality is.
 */
function servedNameOf(row: SigunguGroupable): string | null {
  if (typeof row.sigunguName === "string" && row.sigunguName.trim() !== "") return row.sigunguName;
  if (typeof row.sidoName === "string" && row.sidoName.trim() !== "") return row.sidoName;
  return null;
}

/**
 * THE canonical municipality identity for Page 5 — one key, used by every surface.
 *
 * The served, fully-qualified 시·군·구 name ("인천광역시 강화군"), which already
 * carries its 시·도, so two identically-named 시·군·구 in different 시·도 stay
 * distinct without a second identity system being invented for them.
 */
export function sigunguGroupKeyOf(row: SigunguGroupable): string {
  return servedNameOf(row) ?? UNASSIGNED_SIGUNGU_KEY;
}

/**
 * Keep the FIRST row of each 시·군·구, up to `limit` distinct 시·군·구.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────────
 * A FILTER, not a reducer. Given rows already ordered by their real scenario rank,
 * it returns a subset of those very rows — the highest-ranked one of each 시·군·구 —
 * so each municipality appears at most once in the visible comparison. Every value
 * on a returned row (score, rank, movement) is the value that row already carried;
 * nothing is averaged, combined, re-ranked or synthesised, and the input array and
 * its rows are never mutated.
 *
 * ── WHY IT IS NEEDED ─────────────────────────────────────────────────────────────
 * The real V3 run is extremely concentrated. Under the baseline weights the capital
 * region's top 2,189 candidates lie in just NINE 시·군·구 — the top 41 are all 양평군
 * — so a plain "best 10 candidates" list reads as a single-municipality list and
 * tells a reader nothing about how the region compares.
 *
 * ── THE POSITION IS NOT A RANK ───────────────────────────────────────────────────
 * A row's index here is a DISPLAY POSITION in this list. It is not the candidate's
 * rank and must never be printed as one: on real data the tenth representative is
 * the candidate ranked 2,190th. The caller keeps the row's own `custom_rank`
 * visible beside the position for exactly that reason.
 *
 * `limit` ≤ 0 returns nothing. Fewer distinct 시·군·구 than `limit` returns the
 * fewer that genuinely exist — never a padded list.
 */
export function selectSigunguRepresentatives<Row extends SigunguGroupable>(
  rows: readonly Row[],
  limit: number,
): Row[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const representatives: Row[] = [];
  for (const row of rows) {
    const key = sigunguGroupKeyOf(row);
    // First occurrence wins, and the caller ordered the rows by rank, so the row
    // kept is the group's best-ranked one. Ties therefore resolve exactly as the
    // incoming ranking already resolved them — no new tie-break is invented here.
    if (seen.has(key)) continue;
    seen.add(key);
    representatives.push(row);
    if (representatives.length === limit) break;
  }
  return representatives;
}

/**
 * Group rows by their served 시·군·구, preserving incoming order everywhere.
 *
 * Rows with no 시·군·구 fall back to their 시·도 (so a partly located cell still says
 * where it is), and only a row with neither lands under {@link UNASSIGNED_SIGUNGU_LABEL},
 * which is always sorted last so a real place never sits below the unassigned bucket.
 */
export function groupRowsBySigungu<Row extends SigunguGroupable>(
  rows: readonly Row[],
): SigunguGroup<Row>[] {
  const order: string[] = [];
  const buckets = new Map<string, { label: string; sidoLabel: string | null; rows: Row[] }>();

  for (const row of rows) {
    // The SAME identity `selectSigunguRepresentatives` uses — see `sigunguGroupKeyOf`.
    const served = servedNameOf(row);
    const key = served ?? UNASSIGNED_SIGUNGU_KEY;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      const { sido, sigungu } =
        served === null
          ? { sido: null, sigungu: UNASSIGNED_SIGUNGU_LABEL }
          : splitQualifiedRegionName(served);
      bucket = { label: sigungu, sidoLabel: sido, rows: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.rows.push(row);
  }

  const groups = order.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      key,
      label: bucket.label,
      sidoLabel: bucket.sidoLabel,
      rows: bucket.rows,
      size: sizeOf(bucket.rows),
    };
  });

  // The unassigned bucket last — it is an absence, not a place, and letting it sit
  // above real 시·군·구 headings would read as though it were one.
  const real = groups.filter((group) => group.key !== UNASSIGNED_SIGUNGU_KEY);
  const unassigned = groups.filter((group) => group.key === UNASSIGNED_SIGUNGU_KEY);
  return [...real, ...unassigned];
}

/**
 * The one sentence a grouped surface prints, so a reader knows the heading is a
 * label and not a new scored object.
 */
export const SIGUNGU_GROUPING_NOTE =
  "시·군·구 이름은 후보 구역을 묶어 보여주기 위한 이름표입니다. " +
  "순위·점수·순위 변화는 모두 개별 후보 구역의 값이며, 시·군·구 단위로 평균을 내거나 " +
  "따로 순위를 매기지 않습니다.";
