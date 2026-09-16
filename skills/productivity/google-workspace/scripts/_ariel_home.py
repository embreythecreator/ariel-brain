"""Resolve ARIEL_HOME for standalone skill scripts.

Skill scripts may run outside the Ariel process (e.g. system Python,
nix env, CI) where ``ariel_constants`` is not importable.  This module
provides the same ``get_ariel_home()`` and ``display_ariel_home()``
contracts as ``ariel_constants`` without requiring it on ``sys.path``.

When ``ariel_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``ariel_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``ARIEL_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from ariel_constants import display_ariel_home as display_ariel_home
    from ariel_constants import get_ariel_home as get_ariel_home
except (ModuleNotFoundError, ImportError):

    def get_ariel_home() -> Path:
        """Return the Ariel home directory (default: ~/.ariel).

        Mirrors ``ariel_constants.get_ariel_home()``."""
        val = os.environ.get("ARIEL_HOME", "").strip()
        return Path(val) if val else Path.home() / ".ariel"

    def display_ariel_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``ariel_constants.display_ariel_home()``."""
        home = get_ariel_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
