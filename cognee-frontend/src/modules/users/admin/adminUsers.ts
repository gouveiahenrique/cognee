import localFetch from "@/modules/instances/localFetch";

export interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  tenant_id: string | null;
  created_at: string | null;
}

export async function listUsers(): Promise<AdminUser[]> {
  const response = await localFetch("/v1/users/admin");
  return response.json();
}

export async function createUser(input: { email: string; password: string; isSuperuser: boolean }): Promise<AdminUser> {
  const response = await localFetch("/v1/users/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password, is_superuser: input.isSuperuser }),
  });
  return response.json();
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  await localFetch(`/v1/users/admin/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export async function updateUser(userId: string, patch: { is_active?: boolean; is_superuser?: boolean }): Promise<void> {
  await localFetch(`/v1/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await localFetch(`/v1/users/admin/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export type DatasetPermission = "read" | "write" | "delete" | "share";

export async function grantDatasets(principalId: string, permission: DatasetPermission, datasetIds: string[]): Promise<void> {
  await localFetch(`/v1/permissions/datasets/${encodeURIComponent(principalId)}?permission_name=${permission}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datasetIds),
  });
}

export async function getPrincipalDatasets(principalId: string, permission: DatasetPermission = "read"): Promise<{ id: string; name: string }[]> {
  const response = await localFetch(`/v1/permissions/principals/${encodeURIComponent(principalId)}/datasets?permission_name=${permission}`);
  return response.json();
}

/** Change the signed-in user's own password (fastapi-users PATCH /users/me). */
export async function changeOwnPassword(password: string): Promise<void> {
  await localFetch("/v1/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}
