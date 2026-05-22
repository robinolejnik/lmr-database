"""Shared transformation logic — used by both DDL generation and CSV extraction.

`plan_table(report_table, table_name)` returns a `TablePlan` describing exactly
which source columns survive, what their PG name and type are, what PKs/FKs to
apply, and whether to synthesize a geography point.
"""

from __future__ import annotations

import re
import uuid as _uuid
from dataclasses import dataclass, field
from datetime import datetime, date, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Iterable

import config as cfg

UUID_RE = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")

# ---------- per-cell value cleaners ----------------------------------------


def _to_uuid(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        if UUID_RE.match(v):
            return v.lower()
        return None
    return None


def _to_bool(v: Any) -> bool | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "1", "ja", "yes"):
            return True
        if s in ("false", "0", "nein", "no"):
            return False
    return None


def _to_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if v.is_integer():
            return int(v)
        # tolerate things like 602540000.0 etc
        return int(round(v))
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            try:
                f = float(s)
                if f.is_integer():
                    return int(f)
            except ValueError:
                pass
    return None


def _to_numeric(v: Any) -> str | None:
    """Return a Decimal-stringified version, or None."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int,)):
        return str(v)
    if isinstance(v, float):
        # Use repr to avoid float formatting surprises; postgres accepts e-notation
        return repr(v)
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, str):
        s = v.strip().replace(",", ".")  # tolerate european decimal comma
        if not s:
            return None
        try:
            return str(Decimal(s))
        except InvalidOperation:
            return None
    return None


def _to_timestamp(v: Any) -> str | None:
    """Render as ISO-8601 with UTC tz (we always end up storing the UTC variant)."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc).isoformat()
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        # try a couple of formats from CRM export
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
                return dt.isoformat()
            except ValueError:
                continue
    return None


def _to_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v)
    if s == "":
        return None
    return s


TYPE_TO_CLEANER: dict[str, Callable[[Any], Any]] = {
    "uuid": _to_uuid,
    "boolean": _to_bool,
    "smallint": _to_int,
    "integer": _to_int,
    "bigint": _to_int,
    "numeric": _to_numeric,
    "timestamptz": _to_timestamp,
    "text": _to_text,
}


# ---------- column descriptor ----------------------------------------------


@dataclass
class Col:
    source_idx: int            # column index in the source xlsx row
    source_name: str           # original header
    pg_name: str               # post-strip PG column name
    pg_type: str               # SQL type
    is_pk: bool = False
    is_fk: bool = False
    fk_target: str | None = None  # pg target table name (without schema)
    nullable: bool = True
    strip_spaces: bool = False  # remove spaces from string value before writing

    @property
    def cleaner(self) -> Callable[[Any], Any]:
        return TYPE_TO_CLEANER.get(self.pg_type, _to_text)


@dataclass
class TablePlan:
    source_sheet: str          # original xlsx sheet name
    pg_table: str              # PG table name (== source_sheet for us)
    columns: list[Col]         # PG-order (the columns we keep)
    pk: list[str] = field(default_factory=list)  # one or more pg column names
    fks: list[tuple[str, str]] = field(default_factory=list)  # (pg_col, target_table)
    geo: dict | None = None    # if present: {'out_col', 'lat_idx', 'lon_idx'}
    drop_log: list[str] = field(default_factory=list)  # for inspection: which columns were dropped + why
    rename_log: list[tuple[str, str, str]] = field(default_factory=list)  # (old, new, reason)


# ---------- planner --------------------------------------------------------


def _normalize_type(t: str) -> str:
    """Map analyzer-style type guesses to canonical PG types."""
    if t.startswith("MIXED") or t == "unknown":
        return "text"
    if t == "EMPTY":
        return "text"
    if t == "timestamp":
        return "timestamptz"
    return t


def _is_jaja_nein_companion(col_report, bool_report) -> bool:
    """col_report is the *name companion to bool_report (which is boolean).
    Returns True if every label seen is in {Ja, Nein}.
    """
    distincts = col_report.get("distincts", [])
    labels = {x[0] for x in distincts if x[0] is not None}
    return bool(labels) and labels <= {"Ja", "Nein"}


def plan_table(report_table: dict, table_name: str) -> TablePlan:
    columns_report = report_table["columns"]
    by_name = {c["name"]: c for c in columns_report}
    names = set(by_name.keys())

    # ---- step 1: figure out what we keep, drop, rename --------------------
    plan_cols: list[Col] = []
    drop_log: list[str] = []
    rename_log: list[tuple[str, str, str]] = []

    pk_source = cfg.PK_BY_TABLE.get(table_name)
    if pk_source is not None and pk_source not in names:
        # configured PK column is missing — fall back to synthesized id
        pk_source = None

    fk_set = {col for col, _ in cfg.FK_MAP.get(table_name, [])}
    fk_target_by_col = dict(cfg.FK_MAP.get(table_name, []))

    # Detect *utc → base renames and the bases we should drop
    utc_renames: dict[str, str] = {}  # source `<x>utc` → target `<x>`
    utc_base_drop: set[str] = set()
    if cfg.AUTO_DROP_UTC_TWIN_BASE:
        for name in list(names):
            if name.endswith("utc"):
                base = name[:-3]
                if base in names:
                    # the analyzer must confirm both look like timestamps OR be empty
                    base_t = _normalize_type(by_name[base]["type_guess"])
                    utc_t = _normalize_type(by_name[name]["type_guess"])
                    if {base_t, utc_t} & {"timestamptz", "text"}:  # be permissive
                        utc_renames[name] = base
                        utc_base_drop.add(base)

    # Detect Ja/Nein bool twins
    ja_nein_drop: set[str] = set()
    if cfg.AUTO_DROP_JA_NEIN_TWIN:
        for name in list(names):
            if not name.endswith("name"):
                continue
            base = name[:-4]
            if base not in by_name:
                continue
            base_t = _normalize_type(by_name[base]["type_guess"])
            if base_t == "boolean" and _is_jaja_nein_companion(by_name[name], by_name[base]):
                ja_nein_drop.add(name)

    for idx, col in enumerate(columns_report):
        src = col["name"]
        # already-handled drops
        if src in cfg.GLOBAL_DROP:
            drop_log.append(f"{src}  (global drop list)")
            continue
        if src in utc_base_drop:
            drop_log.append(f"{src}  (local-time twin of {src}utc)")
            continue
        if src in ja_nein_drop:
            drop_log.append(f"{src}  (Ja/Nein label twin)")
            continue

        # Renames
        renamed_from = None
        if src in utc_renames:
            # `src` ends in 'utc'; we keep this column but name it after the base.
            naming_basis = utc_renames[src]
            renamed_from = (src, naming_basis, "utc → canonical")
            # Apply naming-only transform (strip prefix, no global-drop check)
            if naming_basis.startswith(cfg.STRIP_PREFIX):
                pg_name = naming_basis[len(cfg.STRIP_PREFIX):]
            else:
                pg_name = naming_basis
        else:
            pg_name = cfg.pg_column_name(src, table_name)
            if pg_name is None:
                drop_log.append(f"{src}  (pg_column_name returned None)")
                continue

        # FK columns get `_id` suffix so they don't clash with PostGraphile's
        # auto-generated relation field of the same name.
        if src in fk_set and pg_name != "id" and not pg_name.endswith("_id"):
            new_pg_name = pg_name + "_id"
            rename_log.append((pg_name, new_pg_name, "fk → <x>_id"))
            pg_name = new_pg_name

        if renamed_from:
            rename_log.append((renamed_from[0], pg_name, renamed_from[2]))

        # Compute PG type
        override_key = f"{table_name}.{src}"
        if override_key in cfg.TYPE_OVERRIDES:
            pg_type = cfg.TYPE_OVERRIDES[override_key]
        else:
            pg_type = _normalize_type(col["type_guess"])
            # FK columns are always uuid even if the analyzer saw few non-nulls
            if src in fk_set or src == pk_source:
                pg_type = "uuid"
            # *id audit columns are uuid
            if pg_type == "text" and any(
                src == aud or src == aud
                for aud in ("createdby", "modifiedby", "ownerid", "owningbusinessunit", "owningteam", "modifiedonbehalfby", "createdonbehalfby")
            ):
                pg_type = "uuid"

        plan_cols.append(
            Col(
                source_idx=idx,
                source_name=src,
                pg_name=pg_name,
                pg_type=pg_type,
                is_pk=(src == pk_source),
                is_fk=(src in fk_set),
                fk_target=fk_target_by_col.get(src),
                nullable=(src != pk_source),
                strip_spaces=(f"{table_name}.{src}" in cfg.STRIP_SPACES_IN_VALUES),
            )
        )

    # If no PK source: synthesize id column (uuid v4 generated at extract time)
    pk_cols: list[str] = []
    if pk_source is None:
        plan_cols.insert(0, Col(
            source_idx=-1,
            source_name="<synthesized>",
            pg_name="id",
            pg_type="uuid",
            is_pk=True,
            nullable=False,
        ))
        pk_cols = ["id"]
    else:
        pk_cols = ["id"]

    # ---- step 2: geo synthesis --------------------------------------------
    geo = None
    if table_name in cfg.GEO_COMBINE:
        spec = cfg.GEO_COMBINE[table_name]
        lat_idxs = [next(i for i, cc in enumerate(columns_report) if cc["name"] == c) for c in spec["lat_cols"]]
        lon_idxs = [next(i for i, cc in enumerate(columns_report) if cc["name"] == c) for c in spec["lon_cols"]]
        geo = {
            "out_col": spec["out_col"],
            "lat_out_col": spec["lat_out_col"],
            "lon_out_col": spec["lon_out_col"],
            "lat_idx": lat_idxs,
            "lon_idx": lon_idxs,
        }
        # Numeric lat/lon for GraphQL clients (PostGIS preset not available in v5 yet).
        plan_cols.append(Col(
            source_idx=-3,
            source_name="<geo:lat>",
            pg_name=spec["lat_out_col"],
            pg_type="numeric",
        ))
        plan_cols.append(Col(
            source_idx=-4,
            source_name="<geo:lon>",
            pg_name=spec["lon_out_col"],
            pg_type="numeric",
        ))
        # Geography column for SQL-side spatial queries (GiST index).
        plan_cols.append(Col(
            source_idx=-2,
            source_name="<geo>",
            pg_name=spec["out_col"],
            pg_type="geography(Point,4326)",
        ))

    # ---- step 3: FK list --------------------------------------------------
    fks: list[tuple[str, str]] = []
    for col in plan_cols:
        if col.is_fk and col.fk_target:
            fks.append((col.pg_name, col.fk_target))

    return TablePlan(
        source_sheet=table_name,
        pg_table=cfg.pg_table_name(table_name),
        columns=plan_cols,
        pk=pk_cols,
        fks=fks,
        geo=geo,
        drop_log=drop_log,
        rename_log=rename_log,
    )


def dms_to_decimal(deg, minutes, seconds) -> float | None:
    """deg/min/sec triples (Decimal/float/int) → decimal degrees."""
    if deg is None and minutes is None and seconds is None:
        return None
    try:
        d = float(deg or 0)
        m = float(minutes or 0)
        s = float(seconds or 0)
        return d + m / 60.0 + s / 3600.0
    except (TypeError, ValueError):
        return None
