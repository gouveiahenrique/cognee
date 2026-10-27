// Browser-side SDK calls: OAuth authorization must set its nonce cookie in
// this browser, not in a Next server action. localFetch includes credentials.
import localFetch from "@/modules/instances/localFetch";

export type GoogleProvider = "google_drive" | "gmail";
/** Every provider the self-hosted Integrations page connects through the SDK. */
export type SdkProvider = GoogleProvider | "github" | "linear";

export interface GoogleConnection {
  connected: boolean;
  dataset_id?: string | null;
  stored_items?: number;
  account_label?: string | null;
  sync_status?: string | null;
  last_synced_at?: string | null;
  sync_counts?: Record<string, number> | null;
}

// OutDTO serializes Python field names as camelCase on the wire.
interface GoogleConnectionResponse {
  connected: boolean;
  datasetId?: string | null;
  storedItems?: number | null;
  accountLabel?: string | null;
  syncStatus?: string | null;
  lastSyncedAt?: string | null;
  syncCounts?: Record<string, number> | null;
}

export interface GoogleResource {
  id: string;
  name: string;
  description?: string | null;
  selected: boolean;
}

export interface GoogleResources {
  resources: GoogleResource[];
  selected: string[] | null;
}

async function request<T>(provider: SdkProvider, path: string, options?: RequestInit): Promise<T> {
  const response = await localFetch(`/v1/integrations/${provider}/${path}`, options);
  return response.json();
}

export const googleApi = {
  connection: async (provider: SdkProvider): Promise<GoogleConnection> => {
    const response = await request<GoogleConnectionResponse>(provider, "connection");
    return {
      connected: response.connected,
      account_label: response.accountLabel,
      dataset_id: response.datasetId,
      stored_items: response.storedItems ?? undefined,
      sync_status: response.syncStatus,
      last_synced_at: response.lastSyncedAt,
      sync_counts: response.syncCounts,
    };
  },
  authorize: async (provider: SdkProvider) => {
    const response = await request<{ authorizeUrl: string }>(provider, "authorize", { method: "POST" });
    return { authorize_url: response.authorizeUrl };
  },
  resources: (provider: SdkProvider) => request<GoogleResources>(provider, "resources"),
  select: (provider: SdkProvider,resourceIds: string[] | null) =>
    request<{ selected: string[] | null }>(provider, "resources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_ids: resourceIds }),
    }),
  sync: (provider: SdkProvider) =>
    request<{ accepted: boolean }>(provider, "sync", { method: "POST" }),
  disconnect: (provider: SdkProvider,deleteData: boolean) =>
    request<{ disconnected: boolean }>(provider, `connection?delete_data=${deleteData}`, {
      method: "DELETE",
    }),
};

export function googleError(error: unknown): string {
  return error instanceof Error ? error.message : "The Google integration request failed.";
}

// The popup is navigated to whatever the server returns, so only each
// provider's own HTTPS authorization origin is accepted.
const AUTHORIZE_ORIGINS: Record<SdkProvider, { origin: string; label: string }> = {
  google_drive: { origin: "https://accounts.google.com", label: "Google" },
  gmail: { origin: "https://accounts.google.com", label: "Google" },
  github: { origin: "https://github.com", label: "GitHub" },
  linear: { origin: "https://linear.app", label: "Linear" },
};

export function authorizeUrlFor(provider: SdkProvider, raw: string): string {
  const url = new URL(raw);
  const expected = AUTHORIZE_ORIGINS[provider];
  if (url.origin !== expected.origin) {
    throw new Error(`The server returned an unexpected ${expected.label} authorization URL.`);
  }
  return url.href;
}

export function googleAuthorizeUrl(raw: string): string {
  return authorizeUrlFor("google_drive", raw);
}
