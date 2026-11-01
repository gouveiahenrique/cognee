// GitHub and Linear connect through the same self-hosted routes as Google
// (/v1/integrations/{provider}/*, identical request and response shapes), so
// this reuses googleApi instead of copying it. Only the authorization origin
// a popup may be sent to differs per provider.
import { googleApi, type GoogleProvider } from "./googleApi";

export type ConnectorProvider = "github" | "linear";

// googleApi only interpolates the provider into the route path.
const route = (provider: ConnectorProvider) => provider as unknown as GoogleProvider;

export const connectorApi = {
  connection: (provider: ConnectorProvider) => googleApi.connection(route(provider)),
  authorize: (provider: ConnectorProvider) => googleApi.authorize(route(provider)),
  resources: (provider: ConnectorProvider) => googleApi.resources(route(provider)),
  select: (provider: ConnectorProvider, resourceIds: string[] | null) => googleApi.select(route(provider), resourceIds),
  sync: (provider: ConnectorProvider) => googleApi.sync(route(provider)),
  disconnect: (provider: ConnectorProvider, deleteData: boolean) => googleApi.disconnect(route(provider), deleteData),
};

// The popup is navigated to whatever the server returns, so only each
// provider's own HTTPS authorization origin is accepted.
const AUTHORIZE_ORIGINS: Record<ConnectorProvider, { origin: string; label: string }> = {
  github: { origin: "https://github.com", label: "GitHub" },
  linear: { origin: "https://linear.app", label: "Linear" },
};

export function connectorAuthorizeUrl(provider: ConnectorProvider, raw: string): string {
  const url = new URL(raw);
  const expected = AUTHORIZE_ORIGINS[provider];
  if (url.origin !== expected.origin) {
    throw new Error(`The server returned an unexpected ${expected.label} authorization URL.`);
  }
  return url.href;
}

export function connectorError(error: unknown, name: string): string {
  return error instanceof Error ? error.message : `The ${name} integration request failed.`;
}
