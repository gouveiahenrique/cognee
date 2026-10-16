from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cognee.modules.users.api_key import rehash_plaintext_api_keys as module
from cognee.modules.users.api_key.hash_api_key import hash_api_key


def _engine_with(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()

    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    engine = MagicMock()
    engine.get_async_session.return_value = context
    return engine, session


@pytest.mark.asyncio
async def test_noop_when_hashing_disabled():
    with patch.object(module, "HASH_API_KEY", False):
        assert await module.rehash_plaintext_api_keys() == 0


@pytest.mark.asyncio
async def test_hashes_only_plaintext_rows():
    plain = SimpleNamespace(api_key="abc123")
    already = SimpleNamespace(api_key=hash_api_key("other"))
    already_value = already.api_key
    engine, session = _engine_with([plain, already])

    with (
        patch.object(module, "HASH_API_KEY", True),
        patch.object(module, "get_relational_engine", return_value=engine),
    ):
        assert await module.rehash_plaintext_api_keys() == 1

    assert plain.api_key == hash_api_key("abc123")
    assert already.api_key == already_value
    session.commit.assert_awaited_once()
