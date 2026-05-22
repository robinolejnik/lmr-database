"""Read schema_report.json and surface consolidation/redundancy patterns.

Outputs to stdout:
- empty columns (always null in our sample) per table
- (col, colutc) timestamp pairs
- (col, colname) lookup pairs (code/value + label)
- boolean cols with matching <col>name = Ja/Nein
- geo coordinate triples (north/east deg/min/sec)
- audit/system columns present in nearly every table
- per-table primary key candidate
- per-table FK candidates (bnetza_<x> where <x> matches another table)
"""

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
report = json.loads((HERE / "schema_report.json").read_text())

sheets = report["sheets"]
all_tables = set(sheets.keys())
# normalized table names (no suffix) for FK target matching
table_set = set(all_tables)

# ---------- find primary keys ----------
print("\n# PRIMARY KEY CANDIDATES (bnetza_zfd_<table>id)")
pk_map = {}
for t, s in sheets.items():
    if "columns" not in s:
        continue
    cols = [c["name"] for c in s["columns"]]
    cand = f"bnetza_zfd_{t}id"
    if cand in cols:
        pk_map[t] = cand
    else:
        # junction tables may use a compound id
        pks = [c for c in cols if c.startswith("bnetza_bnetza_zfd_") and c.endswith("id")]
        if pks:
            pk_map[t] = pks[0]
        else:
            pk_map[t] = None
    print(f"  {t:<35} → {pk_map[t]}")

# ---------- empty columns ----------
print("\n# EMPTY COLUMNS (always null in sample)")
empty_by_table = {}
for t, s in sheets.items():
    if "columns" not in s:
        continue
    e = [c["name"] for c in s["columns"] if c["non_null"] == 0]
    if e:
        empty_by_table[t] = e
        print(f"  {t}:")
        for c in e:
            print(f"    - {c}")

# ---------- (X, Xutc) timestamp pairs ----------
print("\n# UTC TIMESTAMP DUPLICATION  (col + colutc)")
utc_pairs = defaultdict(list)
for t, s in sheets.items():
    if "columns" not in s:
        continue
    names = {c["name"] for c in s["columns"]}
    for n in names:
        if n.endswith("utc") and n[:-3] in names:
            utc_pairs[t].append((n[:-3], n))
# also report the union of pair stems
stems = Counter()
for t, ps in utc_pairs.items():
    for a, b in ps:
        stems[a] += 1
print("  stems found across tables (most common first):")
for stem, n in stems.most_common(30):
    print(f"    {stem:<35} in {n} tables")

# ---------- (X, Xname) lookup pairs ----------
print("\n# CODE/NAME PAIRS (col + colname)")
name_pair_stems = Counter()
sample_values = {}
for t, s in sheets.items():
    if "columns" not in s:
        continue
    col_by_name = {c["name"]: c for c in s["columns"]}
    names = set(col_by_name.keys())
    for n in names:
        if n.endswith("name") and n[:-4] in names:
            stem = n[:-4]
            name_pair_stems[stem] += 1
            if stem not in sample_values:
                base = col_by_name[stem]
                lbl = col_by_name[n]
                sample_values[stem] = {
                    "base_type": base["type_guess"],
                    "label_type": lbl["type_guess"],
                    "base_distincts": base.get("distincts", [])[:5],
                    "label_distincts": lbl.get("distincts", [])[:5],
                    "first_seen_in": t,
                }
print("  top 40 stems (most common across tables):")
for stem, n in name_pair_stems.most_common(40):
    sv = sample_values[stem]
    print(f"    {stem:<40} in {n:>2} tables | base={sv['base_type']:<10} label={sv['label_type']:<8}")
    if sv["base_distincts"]:
        print(f"        base example: {sv['base_distincts'][:3]}")
        print(f"        lbl  example: {sv['label_distincts'][:3]}")

# ---------- boolean cols with name companion ----------
print("\n# BOOLEAN + JA/NEIN NAME COMPANION")
for t, s in sheets.items():
    if "columns" not in s:
        continue
    col_by_name = {c["name"]: c for c in s["columns"]}
    for n, c in col_by_name.items():
        if c["type_guess"] != "boolean":
            continue
        partner = col_by_name.get(n + "name")
        if not partner:
            continue
        labels = {x[0] for x in partner.get("distincts", []) if x[0] is not None}
        if labels and labels <= {"Ja", "Nein"}:
            print(f"  {t}.{n}  ↔  {n}name  labels={sorted(labels)}")

# ---------- geo coordinates (nord/ost grad/minuten/sekunden) ----------
print("\n# GEO COORDINATES (lat/lon as deg/min/sec triples)")
for t, s in sheets.items():
    if "columns" not in s:
        continue
    names = {c["name"] for c in s["columns"]}
    triples = [
        ("north", ["bnetza_nordgrad", "bnetza_nordminuten", "bnetza_nordsekunden"]),
        ("east", ["bnetza_ostgrad", "bnetza_ostminuten", "bnetza_ostsekunden"]),
    ]
    found = []
    for tag, cols in triples:
        if all(c in names for c in cols):
            found.append((tag, cols))
    if found:
        print(f"  {t}:")
        for tag, cols in found:
            print(f"    {tag}: {cols}")

# ---------- audit columns present across most tables ----------
print("\n# COMMON AUDIT COLUMNS (>=80% of tables)")
col_counts = Counter()
n_tables = len([s for s in sheets.values() if "columns" in s])
for t, s in sheets.items():
    if "columns" not in s:
        continue
    for c in s["columns"]:
        col_counts[c["name"]] += 1
threshold = int(n_tables * 0.8)
for col, n in col_counts.most_common():
    if n >= threshold:
        print(f"  {col:<40} in {n}/{n_tables} tables")

# ---------- FK candidates ----------
print("\n# FK CANDIDATES — `bnetza_<x>` where <x> is another table name")
table_names_sorted = sorted(all_tables, key=len, reverse=True)
for t, s in sheets.items():
    if "columns" not in s:
        continue
    col_by_name = {c["name"]: c for c in s["columns"]}
    matches = []
    for n, c in col_by_name.items():
        if not n.startswith("bnetza_"):
            continue
        if n in (f"bnetza_zfd_{t}id",):
            continue
        if c["type_guess"] != "uuid":
            continue
        stem = n[len("bnetza_"):]
        # try to match an existing table
        for tn in table_names_sorted:
            if stem == tn or stem == tn + "id" or stem == "zfd_" + tn + "id":
                matches.append((n, tn))
                break
    if matches:
        print(f"  {t}:")
        for n, tgt in matches:
            print(f"    {n:<35} → {tgt}")

# ---------- unknowns / mixed types ----------
print("\n# MIXED / UNKNOWN TYPE COLUMNS")
for t, s in sheets.items():
    if "columns" not in s:
        continue
    for c in s["columns"]:
        g = c["type_guess"]
        if g.startswith("MIXED") or g == "unknown":
            print(f"  {t}.{c['name']}: {g}  (n={c['non_null']})")
