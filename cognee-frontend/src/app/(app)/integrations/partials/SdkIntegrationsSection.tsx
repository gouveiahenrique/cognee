"use client";

import { useEffect, useState } from "react";
import { stashOAuthOutcome } from "@/modules/integrations/oauthOutcome";
import type { ConnectorProvider } from "@/modules/integrations/sdkConnectorApi";
import SdkIntegrationCard from "./SdkIntegrationCard";

const PROVIDERS: ConnectorProvider[] = ["github", "linear"];

/** GitHub and Linear cards; rendered next to upstream's GoogleIntegrationsSection. */
export default function SdkIntegrationsSection() {
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null);

  // The backend's callback lands the popup on /integrations?<provider>=<outcome>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = PROVIDERS.find((key) => params.has(key));
    if (provider && window.opener && window.opener !== window) {
      stashOAuthOutcome(provider, params.get(provider));
      window.close();
    }
  }, []);

  return (
    <>
      {PROVIDERS.map((provider) => <SdkIntegrationCard key={provider} provider={provider} connecting={connecting} setConnecting={setConnecting} />)}
    </>
  );
}
