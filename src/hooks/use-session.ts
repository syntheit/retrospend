"use client";

import { authClient } from "~/lib/auth-client";

export const useSession = authClient.useSession;

export type Session = ReturnType<typeof useSession>["data"];
