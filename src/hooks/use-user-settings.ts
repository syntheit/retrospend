"use client";

import { api } from "~/trpc/react";

export function useUserSettings() {
	const { data: settings, ...queryResult } = api.settings.getGeneral.useQuery();

	return {
		settings,
		...queryResult,
	};
}
