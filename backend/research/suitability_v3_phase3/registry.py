"""A **research-only** L2 land-cover classification for Phase-3 measurement.

RESEARCH-ONLY — NOT PRODUCTION POLICY.

``land_conversion.PRODUCTION_REGISTRY`` is ``None`` and stays ``None``: the
developed/artificial class registry is an open blocker owned by a separate audit
lane (see ``LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE``). But
``land_conversion.observe()`` *requires* a registry, so measuring the component's
real coverage and distribution at all requires supplying one.

This module supplies exactly one, for measurement only, and makes three things
impossible to miss:

1. ``approved=False``. The dataclass records it and every provenance dict
   carries it.
2. The registry id names itself as research-only.
3. The contested assignments are declared in ``ambiguous_class_codes`` rather
   than quietly resolved, so the Phase-3 report can measure how much of the
   capital region's area sits on a decision nobody has signed off.

The class codes are the observed L2 (중분류) codes actually present in
``environmental_land_cover_cell_class_areas`` for the capital-region candidate
grid — enumerated from the data, not from an assumed taxonomy. The
developed/not-developed split below follows the *first-digit* grouping of the
source taxonomy (1xx = 시가화·건조지역) and nothing more; it is a reading of the
code structure, not an authority's classification.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The research package sits outside the installed distribution; the successor
# contract it measures lives in the backend source tree.
_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:  # pragma: no cover - import-path bootstrap
    sys.path.insert(0, str(_SRC))

from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    land_conversion,
)

RESEARCH_REGISTRY_ID = "RESEARCH-ONLY-l2-first-digit-v0-NOT-PRODUCTION-POLICY"

# Every L2 code observed in the capital-region candidate-cell class areas.
OBSERVED_L2_CLASS_NAMES: dict[str, str] = {
    "110": "주거지역",
    "120": "공업지역",
    "130": "상업지역",
    "140": "문화·체육·휴양지역",
    "150": "교통지역",
    "160": "공공시설지역",
    "210": "논",
    "220": "밭",
    "230": "시설재배지",
    "240": "과수원",
    "250": "기타재배지",
    "310": "활엽수림",
    "320": "침엽수림",
    "330": "혼효림",
    "410": "자연초지",
    "420": "인공초지",
    "510": "내륙습지",
    "520": "연안습지",
    "610": "자연나지",
    "620": "인공나지",
    "710": "내륙수",
    "720": "해양수",
}

# 1xx — 시가화·건조지역. The one grouping the source taxonomy itself marks as
# built-up, and the only one this research registry treats as developed.
DEVELOPED_L2_CLASS_CODES: frozenset[str] = frozenset({"110", "120", "130", "140", "150", "160"})

# 7xx — 수역. Water is not land, so under a "share of the *land* already
# developed" reading it belongs in neither numerator nor denominator. This is
# itself a contested call, which is why the codes appear in BOTH the excluded
# set and the ambiguous set.
WATER_L2_CLASS_CODES: frozenset[str] = frozenset({"710", "720"})

# Classes whose developed/not-developed assignment is a policy call this lane is
# explicitly not making. Each is resolved into exactly one bucket (the registry
# stays total) and flagged so the resolution is auditable:
#
#   230 시설재배지  — protected/greenhouse cultivation. Physically an artificial
#                     structure on agricultural land; classified here as
#                     NOT developed, following its 2xx 농업지역 grouping.
#   420 인공초지    — artificial grassland. Managed, but not built-up;
#                     classified here as NOT developed.
#   620 인공나지    — artificial bare ground. Frequently construction sites and
#                     earthworks — arguably the most developed non-1xx class;
#                     classified here as NOT developed.
#   710/720 수역    — excluded from both numerator and denominator (see above).
AMBIGUOUS_L2_CLASS_CODES: frozenset[str] = frozenset({"230", "420", "620"}) | WATER_L2_CLASS_CODES

RESEARCH_REGISTRY_NOTE = (
    "RESEARCH-ONLY registry built for Phase-3 measurement. Developed = the 1xx "
    "시가화·건조지역 grouping only, read off the source code structure rather than "
    "supplied by any authority. Water (7xx) is excluded from numerator and "
    "denominator. 230/420/620 are resolved as NOT developed and flagged ambiguous. "
    "This is not an approved classification and must not be used to produce, rank, "
    "or publish any candidate result."
)


def research_registry() -> land_conversion.LandCoverClassRegistry:
    """Build the research-only L2 registry.

    ``approved`` is ``False`` and must stay ``False``: the approved registry is a
    separate lane's deliverable.
    """

    return land_conversion.LandCoverClassRegistry(
        registry_id=RESEARCH_REGISTRY_ID,
        class_level=2,
        developed_class_codes=DEVELOPED_L2_CLASS_CODES,
        known_class_codes=frozenset(OBSERVED_L2_CLASS_NAMES),
        excluded_class_codes=WATER_L2_CLASS_CODES,
        ambiguous_class_codes=AMBIGUOUS_L2_CLASS_CODES,
        source=(
            "Phase-3 research lane; L2 codes enumerated from "
            "environmental_land_cover_cell_class_areas for candidate-grid "
            "capital-grid-500m-v1"
        ),
        approved=False,
        note=RESEARCH_REGISTRY_NOTE,
    )
