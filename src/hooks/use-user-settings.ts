"use client";

import { api } from "~/trpc/react";

export function useUserSettings() {
	const { data: settings, ...queryResult } = api.user.getSettings.useQuery();

	return {
		settings,
		...queryResult,
	};
}
