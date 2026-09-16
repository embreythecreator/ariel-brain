from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    # The launchers live in the managed binary dir OUTSIDE the git checkout
    # (ARIEL_HOME\bin, next to the managed uv) — NOT the whole venv\Scripts
    # (which would shadow the user's python, #83797) and NOT a dir inside
    # the checkout (which `ariel update`'s autostash swept off disk).
    assert "%LOCALAPPDATA%\\ariel\\bin" in doc
    assert (
        "Get-Command ariel        # should print "
        "C:\\Users\\<you>\\AppData\\Local\\ariel\\bin\\ariel.exe"
    ) in doc
    # Installer exposes $ArielHome\bin, and must copy the launchers into it.
    assert '$arielBin = "$ArielHome\\bin"' in install
    assert "ariel.exe" in install and "ariel-acp.exe" in install
    # Guard against regressions to either legacy layout.
    assert '$arielBin = "$InstallDir\\venv\\Scripts"' not in install
    assert '$arielBin = "$InstallDir\\bin"' not in install
