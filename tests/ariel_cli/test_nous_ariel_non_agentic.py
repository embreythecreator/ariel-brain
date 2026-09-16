"""Tests for the Nous-ariel-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"ariel"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``ariel-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "ariel" tag namespace.

``is_nous_ariel_non_agentic`` should only match the actual Ariel
ariel-3 / Ariel-4 chat family.
"""

from __future__ import annotations

import pytest

from ariel_cli.model_switch import (
    _ARIEL_MODEL_WARNING,
    _check_ariel_model_warning,
    is_nous_ariel_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "embreythecreator/ariel-3-Llama-3.1-70B",
        "embreythecreator/ariel-3-Llama-3.1-405B",
        "ariel-3",
        "ariel-3",
        "ariel-4",
        "ariel-4-405b",
        "ariel_4_70b",
        "openrouter/ariel3:70b",
        "openrouter/embreythecreator/ariel-4-405b",
        "embreythecreator/ariel3",
        "ariel-3.1",
    ],
)
def test_matches_real_nous_ariel_chat_models(model_name: str) -> None:
    assert is_nous_ariel_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous Ariel 3/4"
    )
    assert _check_ariel_model_warning(model_name) == _ARIEL_MODEL_WARNING


