import localFetch from "@/modules/instances/localFetch";

export interface CreatedApiKey {
  id: string;
  key: string;
}

// Mirrors the SaaS module's result shape — the synced ApiKeysPage and
// CreateApiKeyButton read `.ok`/`.error`/`.key` and must not care which build
// they're running in.
export type CreateApiKeyResult =
  | { ok: true; key: CreatedApiKey | null }
  | { ok: false; error: string; status?: number };

export default async function createApiKey(
  options: { name?: string; noRedirectOnAuth?: boolean } = {},
): Promise<CreateApiKeyResult> {
  try {
    const response = await localFetch("/v1/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: options.name }),
    });
    const created = await response.json();
    return {
      ok: true,
      key: created?.id && created?.key ? { id: created.id, key: created.key } : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong",
    };
  }
}
