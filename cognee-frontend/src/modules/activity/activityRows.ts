import type { PipelineRun } from "@/ui/elements/AgentActivityTerminal";
import { estimateCostUsd } from "@/modules/sessions/getSessions";

export interface ActivityRow {
  id: string;
  timestamp: string | null;
  action: string;
  status: string;
  background: boolean;
  durationS: number | null;
  user: string;
  dataset: string;
  runId: string | null;
  tokens: number | null;
  costUsd: number | null;
}

// Pipeline runs carry a status; operation records (recall, remember, ...) carry
// an outcome instead. Both normalize to the UPPERCASE label shown in the table.
function statusOf(run: PipelineRun): string {
  const raw = run.kind === "pipeline" ? run.status : run.outcome;
  if (!raw) return "—";
  return raw.replace(/^DATASET_PROCESSING_/, "").replace(/_/g, " ").toUpperCase();
}

function durationOf(run: PipelineRun): number | null {
  if (!run.started_at || !run.ended_at) return null;
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

/** One table row per run, nested operations (parent_operation_id set) dropped
 *  unless `includeNested` — the same folding the cloud activity log applies. */
export function toActivityRows(
  runs: PipelineRun[],
  datasetNames: Record<string, string>,
  userEmails: Record<string, string>,
  includeNested = false,
): ActivityRow[] {
  return runs
    .filter((r) => includeNested || !r.parent_operation_id)
    .map((r) => {
      // null tokens means "not measured", 0 means measured zero — keep the two apart.
      const tokens = r.tokens_in == null && r.tokens_out == null ? null : (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
      const userId = r.user_id ?? r.owner_id;
      return {
        id: r.id,
        timestamp: r.started_at ?? r.created_at,
        action: r.kind === "pipeline" ? (r.pipeline_name ?? "pipeline") : (r.operation_name ?? "operation"),
        status: statusOf(r),
        background: !!r.background,
        durationS: durationOf(r),
        user: (userId && userEmails[userId]) || r.owner_email || "System",
        dataset: r.dataset_name ?? (r.dataset_id ? datasetNames[r.dataset_id] : undefined) ?? "—",
        runId: r.pipeline_run_id,
        tokens,
        costUsd: tokens == null ? null : estimateCostUsd(tokens, 0),
      };
    });
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatCost(usd: number | null): string {
  return usd == null ? "—" : `$${usd.toFixed(4)}`;
}

export function statusColor(status: string): string {
  if (/COMPLETED|SUCCEEDED|ACCEPTED/.test(status)) return "#5CE39A";
  if (/ERROR|FAILED/.test(status)) return "#F0808A";
  if (/STARTED|RUNNING|INITIATED/.test(status)) return "#E6B24D";
  return "rgba(237,236,234,0.58)";
}

export function toCsv(rows: ActivityRow[]): string {
  const header = ["timestamp", "action", "status", "duration_s", "user", "dataset", "run_id", "tokens", "cost_usd_est"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows.map((r) => [r.timestamp, r.action, r.status, r.durationS, r.user, r.dataset, r.runId, r.tokens, r.costUsd])]
    .map((line) => line.map(escape).join(","))
    .join("\n");
}
