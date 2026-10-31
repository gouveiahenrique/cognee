import { averageScore, getCoverage, runCoverage, scoreColor, type DatasetCoverage } from "../coverage";
import type { CogneeInstance } from "@/modules/instances/types";

function instance(body: unknown) {
  const fetch = jest.fn().mockResolvedValue({ json: async () => body });
  return { instance: { name: "t", instanceId: "t", fetch } as CogneeInstance, fetch };
}

test("reads coverage for one dataset", async () => {
  const { instance: i, fetch } = instance(null);
  await expect(getCoverage(i, "d 1")).resolves.toBeNull();
  expect(fetch).toHaveBeenCalledWith("/v1/datasets/d%201/coverage");
});

test("starts a run with POST", async () => {
  const { instance: i, fetch } = instance({ run_id: "r", status: "running", questions_total: 3 });
  await runCoverage(i, "d1");
  expect(fetch).toHaveBeenCalledWith("/v1/datasets/d1/coverage", { method: "POST" });
});

test("averages only scored datasets", () => {
  const scored = (score: number | null) => ({ score } as DatasetCoverage);
  expect(averageScore([scored(80), scored(40), scored(null), null])).toBe(60);
  expect(averageScore([null, scored(null)])).toBeNull();
});

test("colours scores by band", () => {
  expect(scoreColor(90)).toBe("#5CE39A");
  expect(scoreColor(60)).toBe("#E6B24D");
  expect(scoreColor(10)).toBe("#F0808A");
});
