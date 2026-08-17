#!/usr/bin/env python3
"""Daily refresh wrapper — delegates to the Node ingest script (single source of truth)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE_SCRIPT = ROOT / "scripts" / "daily_refresh.mjs"


def main() -> int:
    node = shutil.which("node")
    if node and NODE_SCRIPT.exists():
        return subprocess.call([node, str(NODE_SCRIPT)])

    print(
        "Node.js is required to run the daily refresh (scripts/daily_refresh.mjs).",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
