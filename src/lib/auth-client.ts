import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "~/env";

export const authClient = createAuthClient({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: env.NEXT_PUBLIC_APP_URL,
	plugins: [twoFactorClient()],
});

export type Session = typeof authClient.$Infer.Session;
