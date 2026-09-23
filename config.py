"""Load the project's local .env file without executing its contents."""
from __future__ import annotations

import os
import re
from pathlib import Path

ENV_KEYS = {"LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_TIMEOUT_SECONDS"}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)", line)
        if not match or match.group(1) not in ENV_KEYS:
            continue
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].strip()
        if value and not os.environ.get(key):
            os.environ[key] = value
