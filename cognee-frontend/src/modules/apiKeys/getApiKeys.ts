import localFetch from "@/modules/instances/localFetch";

export interface ApiKey {
  id: string;
  key: string;
  label: string;
  name: string;
}

export default async function getApiKeys(_instance?: unknown): Promise<ApiKey[]> {
  const response = await localFetch("/v1/auth/api-keys");
  return response.json();
}
