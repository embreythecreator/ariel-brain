"""Tests for get_ariel_home() profile-mode fallback warning.

Regression test for https://github.com/embreythecreator/ariel-brain/issues/18594.

When ARIEL_HOME is unset but an active_profile file indicates a non-default
profile is active, get_ariel_home() should:
  1. STILL return ~/.ariel (raising would brick 30+ module-level callers)
  2. Emit a loud one-shot warning to stderr so operators can diagnose
     cross-profile data contamination after the fact.

The warning goes to stderr directly (not through logging) because this
function is called at module-import time from 30+ sites, often before the
logging subsystem has been configured.
"""

from pathlib import Path

import pytest


@pytest.fixture
def fresh_constants(monkeypatch, tmp_path):
    """Import ariel_constants fresh and reset the one-shot warn flag."""
    import importlib
    import ariel_constants
    importlib.reload(ariel_constants)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("ARIEL_HOME", raising=False)
    return ariel_constants


class TestGetArielHomeProfileWarning:
    def test_classic_mode_no_active_profile_no_warning(
        self, fresh_constants, tmp_path, capsys
    ):
        """Classic mode: no active_profile file → silent, returns ~/.ariel."""
        result = fresh_constants.get_ariel_home()
        assert result == tmp_path / ".ariel"
        assert "ARIEL_HOME fallback" not in capsys.readouterr().err


    def test_named_profile_unset_home_warns_once(
        self, fresh_constants, tmp_path, capsys
    ):
        """active_profile=coder + ARIEL_HOME unset → warn loudly, still return fallback."""
        ariel_dir = tmp_path / ".ariel"
        ariel_dir.mkdir()
        (ariel_dir / "active_profile").write_text("coder\n")

        result = fresh_constants.get_ariel_home()

        # 1. Still returns the fallback — no import-time crash
        assert result == tmp_path / ".ariel"
        # 2. Stderr got the warning exactly once
        err = capsys.readouterr().err
        assert err.count("ARIEL_HOME fallback") == 1
        assert "'coder'" in err
        assert "#18594" in err

        # 3. One-shot: second and third calls don't re-warn
        fresh_constants.get_ariel_home()
        fresh_constants.get_ariel_home()
        err2 = capsys.readouterr().err
        assert "ARIEL_HOME fallback" not in err2

    def test_ariel_home_set_suppresses_warning(
        self, fresh_constants, tmp_path, capsys, monkeypatch
    ):
        """Even if active_profile is 'coder', setting ARIEL_HOME suppresses warning."""
        profile_dir = tmp_path / ".ariel" / "profiles" / "coder"
        profile_dir.mkdir(parents=True)
        (tmp_path / ".ariel" / "active_profile").write_text("coder\n")
        monkeypatch.setenv("ARIEL_HOME", str(profile_dir))

        result = fresh_constants.get_ariel_home()

        assert result == profile_dir
        assert "ARIEL_HOME fallback" not in capsys.readouterr().err

    def test_unreadable_active_profile_no_crash(
        self, fresh_constants, tmp_path, capsys
    ):
        """active_profile that can't be decoded → fall through silently."""
        ariel_dir = tmp_path / ".ariel"
        ariel_dir.mkdir()
        # Write bytes that aren't valid utf-8
        (ariel_dir / "active_profile").write_bytes(b"\xff\xfe\x00\x00")

        result = fresh_constants.get_ariel_home()

        assert result == tmp_path / ".ariel"
        # Shouldn't crash; shouldn't warn either (can't tell what profile was intended)
        assert "ARIEL_HOME fallback" not in capsys.readouterr().err

