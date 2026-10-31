"use client";

import CogneeUser from "./CogneeUser";
import getMe from "./getMe";

export default async function getLocalUser(): Promise<CogneeUser | null> {
  // Local mode has no identity provider: the backend session cookie is the
  // source of truth, so read the signed-in user from /users/me.
  try {
    const me = await getMe();
    return { id: me.id, name: me.email.split("@")[0], email: me.email, picture: "" };
  } catch {
    return null;
  }
}
