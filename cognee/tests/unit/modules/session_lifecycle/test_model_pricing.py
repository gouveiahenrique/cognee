"""The pricing table behind session cost: longest-prefix match, provider prefix stripped."""

import pytest

from cognee.modules.session_lifecycle.usage_tracking import estimate_cost_usd

MILLION = 1_000_000


@pytest.mark.parametrize(
    "model,expected",
    [
        ("openai/gpt-6-luna", 0.10 + 0.50),
        ("gpt-6-sol", 2.00 + 10.00),
        # Not a prefix match of gpt-6-sol: has its own entry.
        ("gpt-6.1-sol", 2.00 + 10.00),
        ("gpt-6-astra", 10.00 + 50.00),
        ("claude-haiku-5-5", 0.10 + 0.50),
        # The older generation keeps its own, higher price.
        ("openai/gpt-5.6-luna", 0.20 + 1.20),
    ],
)
def test_known_models_are_priced(model, expected):
    assert estimate_cost_usd(model, MILLION, MILLION) == pytest.approx(expected)


def test_unknown_model_costs_nothing():
    assert estimate_cost_usd("some-unlisted-model", MILLION, MILLION) == 0.0
