import { headers } from "next/headers";
import { cache } from "react";
import { getWebSession } from "./web-session";

/** The web session for server components (see getWebSession). */
export const getSession = cache(async () => getWebSession(await headers()));
