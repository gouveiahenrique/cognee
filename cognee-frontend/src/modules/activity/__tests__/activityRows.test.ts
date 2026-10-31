import { formatDuration, toActivityRows, toCsv } from "../activityRows";
import type { PipelineRun } from "@/ui/elements/AgentActivityTerminal";

function run(overrides: Partial<PipelineRun>): PipelineRun {
  return {
    id: "r1", pipeline_name: null, status: "", dataset_id: null, dataset_name: null,
    owner_id: null, owner_email: null, created_at: "2026-10-16T12:00:00Z", pipeline_run_id: "p1",
    kind: "operation", operation_name: "recall", origin: "api", outcome: "succeeded",
    tokens_in: null, tokens_out: null, started_at: "2026-10-16T12:00:00Z", ended_at: "2026-10-16T12:00:23Z",
    user_id: "u1", session_id: null, parent_operation_id: null, background: null,
    ...overrides,
  };
}

test("maps an operation record to a table row", () => {
  const [row] = toActivityRows([run({ tokens_in: 6000, tokens_out: 1000, dataset_id: "d1" })], { d1: "brain" }, { u1: "henrique" });
  expect(row).toMatchObject({ action: "recall", status: "SUCCEEDED", durationS: 23, user: "henrique", dataset: "brain", tokens: 7000 });
  expect(row.costUsd).toBeGreaterThan(0);
});

test("keeps unmeasured tokens apart from zero", () => {
  const [unmeasured, zero] = toActivityRows([run({ id: "a" }), run({ id: "b", tokens_in: 0, tokens_out: 0 })], {}, {});
  expect(unmeasured.tokens).toBeNull();
  expect(unmeasured.costUsd).toBeNull();
  expect(zero.tokens).toBe(0);
});

test("folds nested operations unless asked for them", () => {
  const runs = [run({ id: "parent" }), run({ id: "child", parent_operation_id: "parent" })];
  expect(toActivityRows(runs, {}, {})).toHaveLength(1);
  expect(toActivityRows(runs, {}, {}, true)).toHaveLength(2);
});

test("labels pipeline runs by name and status", () => {
  const [row] = toActivityRows([run({ kind: "pipeline", pipeline_name: "cognify_pipeline", status: "DATASET_PROCESSING_COMPLETED" })], {}, {});
  expect(row).toMatchObject({ action: "cognify_pipeline", status: "COMPLETED" });
});

test("formats durations and escapes CSV", () => {
  expect(formatDuration(128)).toBe("2m 8s");
  expect(formatDuration(null)).toBe("—");
  const csv = toCsv(toActivityRows([run({ dataset_name: 'a,"b"' })], {}, {}));
  expect(csv.split("\n")[1]).toContain('"a,""b"""');
});
