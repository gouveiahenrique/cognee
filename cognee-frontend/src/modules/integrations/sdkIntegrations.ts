import type { SdkProvider } from "./googleApi";

/**
 * Self-hosted connectors, connected per user straight through this backend's
 * /api/v1/integrations/{provider}/* routes (no cloud control plane). Each entry
 * describes only what differs between providers; the card itself is shared.
 */
export interface SdkIntegrationCfg {
  key: SdkProvider;
  name: string;
  description: string;
  initials: string;
  logo: string;
  color: string;
  /** The company behind the OAuth window ("Opens Google’s authorization window"). */
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
    /** Plural noun, lowercase ("folders and shared drives"). */
    noun: string;
    /** Section heading word ("folders" → "Choose folders"). */
    heading: string;
    /** Capitalized singular for status text ("Folder list unavailable"). */
    singular: string;
    allLabel: string;
    hint?: string;
  } | null;
  /** The backend exposes a deletable dataset for this provider on disconnect. */
  deletableDataset: boolean;
}

export const SDK_INTEGRATIONS: Record<SdkProvider, SdkIntegrationCfg> = {
  google_drive: {
    key: "google_drive",
    name: "Google Drive",
    description: "Read selected folders and shared drives into your Context Mesh memory.",
    initials: "Dr",
    logo: "googledrive",
    color: "#4285F4",
    vendor: "Google",
    accountFallback: "Google account",
    permissions: ["Read files from the folders and shared drives you select", "Keep your imported files searchable in Context Mesh"],
    importNote: "Nothing is imported until you select folders and shared drives and sync. Imported content is processed by your configured Context Mesh models.",
    resources: { noun: "folders and shared drives", heading: "folders", singular: "Folder", allLabel: "Entire My Drive and all shared drives" },
    deletableDataset: true,
  },
  gmail: {
    key: "gmail",
    name: "Gmail",
    description: "Read selected labels into your Context Mesh memory.",
    initials: "Gm",
    logo: "gmail",
    color: "#EA4335",
    vendor: "Google",
    accountFallback: "Google account",
    permissions: ["Read messages matching the labels you select", "Keep your imported messages searchable in Context Mesh"],
    importNote: "Nothing is imported until you select labels and sync. Imported content is processed by your configured Context Mesh models.",
    resources: { noun: "labels", heading: "labels", singular: "Label", allLabel: "Entire mailbox (all labels)", hint: "Messages must match all selected labels." },
    deletableDataset: true,
  },
  github: {
    key: "github",
    name: "GitHub",
    description: "Index the repositories you install the Context Mesh app on.",
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
    permissions: ["Read issues, comments and projects from the teams you select", "Answer @mentions in Linear from your Context Mesh memory"],
    importNote: "Every team is synced until you narrow the selection. Imported content is processed by your configured Context Mesh models.",
    resources: { noun: "teams", heading: "teams", singular: "Team", allLabel: "All teams" },
    deletableDataset: true,
  },
};
