"use client";

/**
 * Pagination for the unmapped-facility list.
 *
 * Rendered from the LAST SERVED total rather than from the response in hand, so a
 * failed page request leaves the controls operable instead of unmounting them and
 * stranding the reader on a page they cannot navigate away from.
 *
 * Deliberately not wrapped in a `<nav>`: the shell owns the application's single
 * navigation landmark, and a second one here would make the landmark list — and the
 * "exactly one nav" assertions in both suites — wrong. Native `<button>`s with
 * explicit accessible names carry the whole affordance, and `disabled` states the
 * boundary rather than hiding it.
 */

import { formatCount } from "../../lib/metrics";

export interface UnmappedPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}

export default function UnmappedPagination({
  page,
  totalPages,
  total,
  onChange,
}: UnmappedPaginationProps) {
  return (
    <div
      className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-muted"
      data-testid="transparency-unmapped-pagination"
    >
      <span className="tabular-nums">
        {page} / {totalPages} 페이지 · 총 {formatCount(total)}개
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          className="wep-btn-quiet"
          disabled={page <= 1}
          // "이전" alone is ambiguous out of context for a screen-reader user
          // scanning by name; the visible label stays short.
          aria-label="이전 페이지"
          onClick={() => onChange(Math.max(1, page - 1))}
          data-testid="transparency-unmapped-prev"
        >
          이전
        </button>
        <button
          type="button"
          className="wep-btn-quiet"
          disabled={page >= totalPages}
          aria-label="다음 페이지"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          data-testid="transparency-unmapped-next"
        >
          다음
        </button>
      </div>
    </div>
  );
}
