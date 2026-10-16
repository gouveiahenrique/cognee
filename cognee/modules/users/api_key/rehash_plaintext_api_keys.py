from sqlalchemy import select

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.users.models.UserApiKey import UserApiKey

from .hash_api_key import HASH_API_KEY, hash_api_key

_HASH_PREFIX = "pbkdf2_sha256$"


async def rehash_plaintext_api_keys() -> int:
    """Hash keys that were stored before HASH_API_KEY was turned on.

    Lookups hash the presented key once HASH_API_KEY is true, so a key stored in
    plain text would stop authenticating. Rewriting it in place keeps every
    existing client working. A no-op while hashing is off; safe to run on every
    startup since already-hashed rows are skipped. Returns the number rewritten.
    """
    if not HASH_API_KEY:
        return 0

    rewritten = 0
    async with get_relational_engine().get_async_session() as session:
        api_keys = (await session.execute(select(UserApiKey))).scalars().all()
        for api_key in api_keys:
            if api_key.api_key.startswith(_HASH_PREFIX):
                continue
            api_key.api_key = hash_api_key(api_key.api_key)
            rewritten += 1
        if rewritten:
            await session.commit()
    return rewritten
