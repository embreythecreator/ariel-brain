"""Resolve ARIEL_HOME for standalone skill scripts.

Skill scripts may run outside the Ariel process (system Python, nix env,
CI) where ``ariel_constants`` is not importable.  This module provides the
same ``get_ariel_home()`` contract without requiring it on ``sys.path``.

When ``ariel_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from ariel_constants import get_ariel_home as get_ariel_home
except (ModuleNotFoundError, ImportError):

    def get_ariel_home() -> Path:
        """Return the Ariel home directory (default: ``~/.ariel``)."""
        val = os.environ.get("ARIEL_HOME", "").strip()
        return Path(val) if val else Path.home() / ".ariel"
