"use client";

import { useCallback } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

export type GeneralSettings = RouterOutputs["settings"]["getGeneral"];
export type GeneralPatch = Omit<
	RouterInputs["settings"]["updateGeneral"],
	"homeCurrency"
> & { homeCurrency?: string };

/**
 * The user's general settings and a writer for one field at a time.
 * settings.updateGeneral needs the home currency on every call, so a patch
 * without it sends the current one (the router only writes what it is given).
 */
export function useGeneralSettings() {
	const query = api.settings.getGeneral.useQuery();
	const utils = api.useUtils();
	const mutation = api.settings.updateGeneral.useMutation();
	const home = query.data?.homeCurrency;

	const update = useCallback(
		async (patch: GeneralPatch) => {
			const homeCurrency = patch.homeCurrency ?? home;
			if (!homeCurrency) throw new Error("Settings are not loaded");
			await mutation.mutateAsync({ ...patch, homeCurrency });
			await utils.settings.getGeneral.invalidate();
		},
		[home, mutation, utils],
	);

	return {
		settings: query.data,
		isLoading: query.isLoading,
		isError: query.isError,
		refetch: query.refetch,
		update,
	};
}
