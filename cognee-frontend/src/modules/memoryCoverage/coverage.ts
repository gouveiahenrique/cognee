import type { CogneeInstance } from "@/modules/instances/types";

export interface CoverageQuestion {
  question: string;
  answer: string | null;
  score: number | null;
  reason: string | null;
  missing: string | null;
}

export interface DatasetCoverage {
  run_id: string;
  dataset_id: string;
  status: "running" | "completed" | "errored";
  score: number | null;
  questions_total: number;
  questions_scored: number;
  questions_available: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  questions: CoverageQuestion[];
}

/** Latest analysis for a dataset, or null when it has never been analysed. */
export async function getCoverage(instance: CogneeInstance, datasetId: string): Promise<DatasetCoverage | null> {
  const response = await instance.fetch(`/v1/datasets/${encodeURIComponent(datasetId)}/coverage`);
  return response.json();
}

/** Start an analysis: replays the dataset's past questions and scores each (costs LLM calls). */
export async function runCoverage(instance: CogneeInstance, datasetId: string): Promise<{ run_id: string; status: string; questions_total: number }> {
  const response = await instance.fetch(`/v1/datasets/${encodeURIComponent(datasetId)}/coverage`, { method: "POST" });
  return response.json();
}

export function scoreColor(score: number | null): string {
  if (score == null) return "rgba(237,236,234,0.36)";
  if (score >= 75) return "#5CE39A";
  if (score >= 50) return "#E6B24D";
  return "#F0808A";
}

/** Mean of the scored datasets' coverage — what the Overview card calls "real recall". */
export function averageScore(coverages: (DatasetCoverage | null)[]): number | null {
  const scores = coverages.map((c) => c?.score).filter((s): s is number => typeof s === "number");
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
