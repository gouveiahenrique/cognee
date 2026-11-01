import type { ConnectorProvider } from "./sdkConnectorApi";

/**
 * GitHub and Linear on the self-hosted Integrations page, connected per user
 * through this backend's /api/v1/integrations/{provider}/* routes (no cloud
 * control plane). Google Drive and Gmail keep upstream's own card. Each entry
 * describes only what differs between providers; the card itself is shared.
 */
export interface SdkIntegrationCfg {
  key: ConnectorProvider;
  name: string;
  description: string;
  initials: string;
  logo: string;
  color: string;
  /** The company behind the OAuth window ("Opens GitHub’s authorization window"). */
  vendor: string;
  /** Fallback when the connection carries no account label. */
  accountFallback: string;
  permissions: string[];
  /** What a connect does before the user acts, shown under the connect button. */
  importNote: string;
  /**
   * The provider's picker vocabulary, or null when it has no picker on our
   * side (GitHub: repositories are chosen on GitHub's install screen).
   */
  resources: {
    /** Plural noun, lowercase ("teams"). */
    noun: string;
    /** Section heading word ("teams" → "Choose teams"). */
    heading: string;
    /** Capitalized singular for status text ("Team list unavailable"). */
    singular: string;
    allLabel: string;
    hint?: string;
  } | null;
  /** The backend exposes a deletable dataset for this provider on disconnect. */
  deletableDataset: boolean;
}

export const SDK_INTEGRATIONS: Record<ConnectorProvider, SdkIntegrationCfg> = {
  github: {
    key: "github",
    name: "GitHub",
    description: "Index the repositories you install the Cognee app on.",
    initials: "GH",
    logo: "github",
    color: "#181717",
    vendor: "GitHub",
    accountFallback: "GitHub account",
    permissions: ["Read the contents of the repositories you choose on GitHub", "Re-index a repository whenever it is pushed to"],
    importNote: "You choose repositories on GitHub’s install screen; they are indexed as soon as the install completes.",
    resources: null,
    deletableDataset: false,
  },
  linear: {
    key: "linear",
    name: "Linear",
    description: "Read issues, comments and projects from the teams you select.",
    initials: "Li",
    logo: "linear",
    color: "#5E6AD2",
    vendor: "Linear",
    accountFallback: "Linear workspace",
    permissions: ["Read issues, comments and projects from the teams you select", "Answer @mentions in Linear from your Cognee memory"],
    importNote: "Every team is synced until you narrow the selection. Imported content is processed by your configured Cognee models.",
    resources: { noun: "teams", heading: "teams", singular: "Team", allLabel: "All teams" },
    deletableDataset: true,
  },
};
