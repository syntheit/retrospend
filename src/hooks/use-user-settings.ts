"use client";

import { authClient } from "~/lib/auth-client";
import { api } from "~/trpc/react";

export function useUserSettings() {
	const { data: session } = authClient.useSession();
	const { data: settings, ...queryResult } = api.settings.getGeneral.useQuery(
		undefined,
		{ enabled: !!session?.user, staleTime: 30 * 60 * 1000 },
	);

	return {
		settings,
		...queryResult,
	};
}
