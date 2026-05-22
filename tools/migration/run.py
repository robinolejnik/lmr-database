"""End-to-end runner: analyze → build schema → extract → load.

Use this when starting from scratch. Individual stages can also be run on
their own — see the corresponding modules.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(cmd: list[str]):
    print(f"\n$ {' '.join(cmd)}", flush=True)
    rc = subprocess.call(cmd)
    if rc != 0:
        sys.exit(f"failed: {' '.join(cmd)} (exit {rc})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-analyze", action="store_true", help="reuse existing schema_report.json")
    ap.add_argument("--skip-extract", action="store_true", help="reuse existing /tmp/lmr-csv")
    ap.add_argument("--clean", action="store_true", help="drop schema before loading")
    args = ap.parse_args()

    py = sys.executable

    if not args.skip_analyze:
        run([py, str(HERE / "analyze.py")])
    run([py, str(HERE / "build_schema.py")])
    if not args.skip_extract:
        run([py, str(HERE / "extract.py")])
    load_cmd = [py, str(HERE / "load.py")]
    if args.clean:
        load_cmd.append("--clean")
    run(load_cmd)


if __name__ == "__main__":
    main()
