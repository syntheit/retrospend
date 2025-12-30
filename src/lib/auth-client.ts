import { createAuthClient } from "better-auth/react";
import { env } from "~/env";

export const authClient = createAuthClient({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: env.NEXT_PUBLIC_APP_URL,
});

export type Session = typeof authClient.$Infer.Session;
