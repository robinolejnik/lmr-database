"""Apply schema, COPY data, apply constraints. All in one go.

CLI:
  load.py            run all steps
  load.py --clean    drop the schema first (destructive)
  load.py --schema-only
  load.py --copy-only
  load.py --constraints-only
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg

import config as cfg

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
INIT = REPO_ROOT / "db" / "init"
CSV_DIR = Path("/tmp/lmr-csv")


def connect():
    dsn = os.environ.get("PG_DSN", "postgres://lmr:lmr@127.0.0.1:5432/lmr")
    return psycopg.connect(dsn)


def run_sql_file(conn, path: Path):
    print(f"  applying {path.relative_to(REPO_ROOT)} ({path.stat().st_size} bytes)...")
    with path.open("r", encoding="utf-8") as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def drop_schema(conn):
    with conn.cursor() as cur:
        cur.execute(f"DROP SCHEMA IF EXISTS {cfg.PG_SCHEMA} CASCADE;")
    conn.commit()
    print(f"  dropped schema {cfg.PG_SCHEMA}")


def copy_csv(conn, plan):
    csv_path = CSV_DIR / f"{plan['pg_table']}.csv"
    if not csv_path.exists():
        print(f"  !! {plan['pg_table']}: csv missing at {csv_path}")
        return
    # peek header line
    with csv_path.open("r", encoding="utf-8") as f:
        header = f.readline().rstrip("\r\n")
    col_list = ", ".join(f'"{c}"' if c == "name" else c for c in header.split(","))
    t0 = time.time()
    n_rows = 0
    with conn.cursor() as cur:
        sql = (
            f"COPY {cfg.PG_SCHEMA}.\"{plan['pg_table']}\" ({col_list}) "
            f"FROM STDIN WITH (FORMAT CSV, HEADER, NULL '')"
        )
        with cur.copy(sql) as copy, csv_path.open("rb") as fb:
            while chunk := fb.read(1024 * 1024):
                copy.write(chunk)
        n_rows = cur.rowcount
    conn.commit()
    print(f"  {plan['pg_table']:<35} {n_rows:>8} rows in {time.time()-t0:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true", help="drop schema before loading")
    ap.add_argument("--schema-only", action="store_true")
    ap.add_argument("--copy-only", action="store_true")
    ap.add_argument("--constraints-only", action="store_true")
    args = ap.parse_args()

    plans = json.loads((HERE / "plans.json").read_text())

    with connect() as conn:
        if args.clean and not (args.copy_only or args.constraints_only):
            drop_schema(conn)

        if not (args.copy_only or args.constraints_only):
            run_sql_file(conn, INIT / "01_schema.sql")
            if args.schema_only:
                return

        if not (args.schema_only or args.constraints_only):
            print("\n== COPY ==")
            t0 = time.time()
            for plan in plans:
                copy_csv(conn, plan)
            print(f"  copy total: {time.time()-t0:.1f}s")
            if args.copy_only:
                return

        if not (args.schema_only or args.copy_only):
            print("\n== constraints ==")
            run_sql_file(conn, INIT / "02_constraints.sql")
            # Idempotent: grants for app_* roles (created by graphile-migrate)
            # so the legacy schema is queryable after every clean re-import.
            print("\n== legacy grants ==")
            run_sql_file(conn, INIT / "03_legacy_grants.sql")


if __name__ == "__main__":
    main()
