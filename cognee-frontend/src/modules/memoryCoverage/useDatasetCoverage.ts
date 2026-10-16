"use client";

import { useQuery } from "@tanstack/react-query";
import { useCogniInstance } from "@/modules/tenant/TenantProvider";
import { type DatasetCoverage, getCoverage } from "./coverage";

/** Latest coverage per dataset id; a dataset that fails to load maps to null. */
export function useDatasetCoverage(datasetIds: string[]) {
  const { cogniInstance, isInitializing } = useCogniInstance();
  return useQuery({
    queryKey: ["dataset-coverage", cogniInstance?.instanceId ?? null, [...datasetIds].sort()],
    queryFn: async (): Promise<Record<string, DatasetCoverage | null>> => {
      if (!cogniInstance) return {};
      const entries = await Promise.all(
        datasetIds.map(async (id) => [id, await getCoverage(cogniInstance, id).catch(() => null)] as const),
      );
      return Object.fromEntries(entries);
    },
    enabled: !!cogniInstance && !isInitializing && datasetIds.length > 0,
    staleTime: 60_000,
  });
}
