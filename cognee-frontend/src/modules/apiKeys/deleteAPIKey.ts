import localFetch from "@/modules/instances/localFetch";

export default async function deleteApiKey(keyId: string): Promise<void> {
  await localFetch(`/v1/auth/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
  });
}
