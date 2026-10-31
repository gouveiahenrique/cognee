"use client";

import { useEffect, useState } from "react";
import { stashOAuthOutcome } from "@/modules/integrations/oauthOutcome";
import type { SdkProvider } from "@/modules/integrations/googleApi";
import SdkIntegrationCard from "./SdkIntegrationCard";

// Order on the page: the code and issue trackers first, then the Google pair.
export const SDK_PROVIDERS: SdkProvider[] = ["github", "linear", "google_drive", "gmail"];

export default function SdkIntegrationsSection() {
  const [connecting, setConnecting] = useState<SdkProvider | null>(null);

  // The backend's callback lands the popup on /integrations?<provider>=<outcome>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = SDK_PROVIDERS.find((key) => params.has(key));
    if (provider && window.opener && window.opener !== window) {
      stashOAuthOutcome(provider, params.get(provider));
      window.close();
    }
  }, []);

  return (
    <>
      {SDK_PROVIDERS.map((provider) => <SdkIntegrationCard key={provider} provider={provider} connecting={connecting} setConnecting={setConnecting} />)}
    </>
  );
}
