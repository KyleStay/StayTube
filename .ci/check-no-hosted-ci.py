#!/usr/bin/env python3
"""Keep archived workflow references out of GitHub's active workflow directory."""
import os
from pathlib import Path
root = Path(__file__).resolve().parents[1]
active = root / ".github" / "workflows"
files = sorted(p for p in active.glob("*") if p.suffix.lower() in {".yml", ".yaml"})
if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
    raise SystemExit("CI is local-only; GitHub Actions execution is prohibited.")
if files:
    raise SystemExit("Active workflow files are prohibited: " + ", ".join(str(p.relative_to(root)) for p in files))
print("Local-only CI guard passed")
