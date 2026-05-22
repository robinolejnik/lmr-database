"""Stream the xlsx workbooks to per-table CSV files under /tmp/lmr-csv/.

Uses python-calamine for fast streaming reads. Applies the same column
selection / typing / renaming as build_schema.py via the shared TablePlan.
"""

from __future__ import annotations

import csv
import json
import sys
import uuid
from datetime import datetime, date, timezone
from pathlib import Path

from decimal import Decimal, InvalidOperation

from python_calamine import CalamineWorkbook

import config as cfg
from transform import dms_to_decimal, TYPE_TO_CLEANER


def to_hz(value, unit_label) -> str | None:
    """Convert (numeric_value, unit_label) → string of Decimal Hz, or None.

    Unit labels seen in the dataset are 'MHz' / 'GHz' but we tolerate the
    common siblings (Hz/kHz/THz) and ignore casing/whitespace. Unknown units
    yield None — the cell stays NULL rather than mis-recording a value at
    the wrong scale.
    """
    if value is None or value == "" or unit_label is None:
        return None
    label = str(unit_label).strip()
    if not label:
        return None
    multiplier = cfg.UNIT_MULTIPLIERS.get(label)
    if multiplier is None:
        return None
    try:
        if isinstance(value, (int, float, Decimal)):
            d = Decimal(str(value))
        else:
            s = str(value).strip().replace(",", ".")
            if not s:
                return None
            d = Decimal(s)
    except (InvalidOperation, ValueError):
        return None
    return str(d * Decimal(multiplier))

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
DATA_DIR = REPO_ROOT / "data"
CSV_DIR = Path("/tmp/lmr-csv")


def load_plans():
    return json.loads((HERE / "plans.json").read_text())


def write_table(book, plan, csv_dir: Path):
    sheet_name = plan["source_sheet"]
    if sheet_name not in book.sheet_names:
        print(f"  !! {sheet_name}: sheet not in workbook")
        return None

    sheet = book.get_sheet_by_name(sheet_name)
    out_path = csv_dir / f"{plan['pg_table']}.csv"
    n_written = 0
    n_seen = 0
    n_dropped_no_pk = 0

    # Pre-resolve cleaners
    cols = plan["columns"]
    geo = plan.get("geo")
    hz_specs = plan.get("hz") or []
    # Map by out_col so we can look up the source indexes from the column.
    hz_by_out = {spec["out_col"]: spec for spec in hz_specs}

    row_iter = sheet.iter_rows()
    try:
        header = next(row_iter)
    except StopIteration:
        print(f"  -- {sheet_name}: empty")
        return None

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        w.writerow([c["pg_name"] for c in cols])

        for row in row_iter:
            n_seen += 1
            out_row = []
            row_pk_ok = True
            for col in cols:
                src_idx = col["source_idx"]
                if src_idx == -1:
                    # synthesized id (no source) — uuid4
                    val = str(uuid.uuid4())
                elif src_idx == -2:
                    # geo — synthesized below
                    val = ""
                elif src_idx == -5:
                    # hz unit-normalization — synthesized inline
                    spec = hz_by_out.get(col["pg_name"])
                    if spec is None:
                        val = None
                    else:
                        v = row[spec["value_idx"]] if spec["value_idx"] < len(row) else None
                        u = row[spec["unit_idx"]]  if spec["unit_idx"]  < len(row) else None
                        val = to_hz(v, u)
                else:
                    raw = row[src_idx] if src_idx < len(row) else None
                    cleaner = TYPE_TO_CLEANER.get(col["pg_type"], TYPE_TO_CLEANER["text"])
                    val = cleaner(raw)
                    if col.get("strip_spaces") and isinstance(val, str):
                        val = val.replace(" ", "")

                if col["is_pk"] and (val is None or val == ""):
                    row_pk_ok = False
                    break

                if val is None:
                    out_row.append("")  # COPY CSV interprets empty as NULL with NULL ''
                elif isinstance(val, bool):
                    out_row.append("t" if val else "f")
                else:
                    out_row.append(str(val))

            if not row_pk_ok:
                n_dropped_no_pk += 1
                continue

            if geo:
                lat = dms_to_decimal(*[row[i] for i in geo["lat_idx"]])
                lon = dms_to_decimal(*[row[i] for i in geo["lon_idx"]])
                if lat is not None and lon is not None and (-90 <= lat <= 90) and (-180 <= lon <= 180):
                    lat_pos = next(i for i, c in enumerate(cols) if c["pg_name"] == geo["lat_out_col"])
                    lon_pos = next(i for i, c in enumerate(cols) if c["pg_name"] == geo["lon_out_col"])
                    geo_pos = next(i for i, c in enumerate(cols) if c["pg_name"] == geo["out_col"])
                    out_row[lat_pos] = f"{lat}"
                    out_row[lon_pos] = f"{lon}"
                    out_row[geo_pos] = f"SRID=4326;POINT({lon} {lat})"

            w.writerow(out_row)
            n_written += 1

    print(f"  {sheet_name:<35} → {plan['pg_table']:<35} {n_written:>8} rows  (seen {n_seen}, dropped {n_dropped_no_pk})")
    return out_path


def main():
    CSV_DIR.mkdir(parents=True, exist_ok=True)

    plans = load_plans()
    plans_by_sheet = {p["source_sheet"]: p for p in plans}

    for fname in cfg.SOURCE_FILES:
        path = DATA_DIR / fname
        print(f"\n=== {fname} ===")
        book = CalamineWorkbook.from_path(str(path))
        for sheet_name in book.sheet_names:
            if sheet_name in cfg.SKIP_SHEETS:
                continue
            plan = plans_by_sheet.get(sheet_name)
            if not plan:
                print(f"  !! {sheet_name}: no plan, skipping")
                continue
            write_table(book, plan, CSV_DIR)


if __name__ == "__main__":
    main()
