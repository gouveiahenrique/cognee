"use server";

import CogneeUser from "./CogneeUser";

/**
 * Open-source version. Local mode resolves the user in the browser from the
 * backend session cookie (see getLocalUser); this server-side fallback only
 * exists so the shared useCurrentUser signature stays the same.
 */
export default async function getUser(): Promise<CogneeUser> {
  return {
    id: "local",
    name: "Local User",
    email: "local@cognee.local",
    picture: "",
  };
}
