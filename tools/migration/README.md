# Migration scripts

One-time but **re-runnable** migration from the two Dynamics 365 xlsx exports
(in `../../data/`) to the `legacy` schema in PostgreSQL + PostGIS.

The pipeline is five small stages, each runnable in isolation:

```
analyze.py        ➜  schema_report.json            (column stats per sheet)
build_schema.py   ➜  ../../db/init/*.sql + plans.json
extract.py        ➜  /tmp/lmr-csv/*.csv            (typed, transformed, ~1.6 GB)
load.py           ➜  postgres ← schema, COPY, constraints
```

Or run them all at once with `run.py` (or via `pnpm migrate[:clean]` from the
repo root).

## First-time setup

```bash
cd tools/migration
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Tweaking the schema

[config.py](config.py) is the single place where schema decisions live:

- `GLOBAL_DROP` — column names to drop from every table
- `TYPE_OVERRIDES` — per-column type pins (e.g. force `numeric` on
  ambiguous int/float columns)
- `FK_MAP` — manually-curated foreign-key relationships
- `GEO_COMBINE` — deg/min/sec triples to combine into PostGIS points
- `PK_BY_TABLE` — primary-key source columns (auto-renamed to `id`)

After editing `config.py`, re-run from `build_schema.py` onwards.

## Type overrides

The analyzer occasionally sees columns with mixed int+float values (e.g.
`bnetza_frequenz1` has both `450` and `450.7625`). Those need a manual
`numeric` override. Run `summarize.py` to see the current set of mixed
columns:

```bash
.venv/bin/python summarize.py | grep MIXED
```

## Sample size

`analyze.py` reads up to `SAMPLE_CAP = 8000` rows from each sheet — plenty
for type inference and enum cardinality. Bump it if you need stronger
guarantees, or set it to `None` for a full scan (slower).

## Debugging a particular table

```bash
.venv/bin/python -c "
import json, transform
report = json.load(open('schema_report.json'))
plan = transform.plan_table(report['sheets']['antenne'], 'antenne')
for c in plan.columns: print(c.pg_name, c.pg_type, c.source_name)
print('drops:', plan.drop_log)
print('fks  :', plan.fks)
"
```
