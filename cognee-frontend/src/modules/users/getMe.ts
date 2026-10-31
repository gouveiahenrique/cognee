import localFetch from "@/modules/instances/localFetch";

export interface Me {
  id: string;
  email: string;
  is_superuser: boolean;
  tenant_id: string | null;
}

export default async function getMe(): Promise<Me> {
  const response = await localFetch("/v1/users/me");
  return response.json();
}
