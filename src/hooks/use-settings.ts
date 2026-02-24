"use client";

import { api } from "~/trpc/react";

export function useSettings() {
	return api.settings.getGeneral.useQuery(undefined, {
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes
	});
}
