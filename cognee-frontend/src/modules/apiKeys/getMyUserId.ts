import localFetch from "@/modules/instances/localFetch";

export default async function getMyUserId(): Promise<string | null> {
  const response = await localFetch("/v1/users/me");
  const me = await response.json();
  return typeof me?.id === "string" ? me.id : null;
}
