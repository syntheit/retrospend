"use client";

import { useCallback } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useAutosave, useSaveGuard } from "../autosave";

export type GeneralSettings = RouterOutputs["settings"]["getGeneral"];
export type GeneralPatch = RouterInputs["settings"]["updateGeneral"];
type Key = keyof GeneralPatch & keyof GeneralSettings;

/**
 * The user's general settings and a writer for one field at a time. A write
 * sends only its own field, and the cache shows it at once, so a quick
 * second change or a late Undo never carries another field's older value
 * (settings.updateGeneral writes only what it is given). A failed write
 * puts the field back.
 */
export function useGeneralSettings() {
	const query = api.settings.getGeneral.useQuery();
	const utils = api.useUtils();
	const { mutateAsync } = api.settings.updateGeneral.useMutation();

	const update = useCallback(
		async (patch: GeneralPatch) => {
			const cache = utils.settings.getGeneral;
			const before = cache.getData();
			const shown = (data: Partial<GeneralSettings>) =>
				cache.setData(undefined, (old) =>
					old ? { ...old, ...data } : old,
				);
			shown(patch as Partial<GeneralSettings>);
			try {
				await mutateAsync(patch);
			} catch (err) {
				if (before) {
					const keys = Object.keys(patch) as Key[];
					shown(Object.fromEntries(keys.map((k) => [k, before[k]])));
				}
				throw err;
			} finally {
				await cache.invalidate();
			}
		},
		[mutateAsync, utils],
	);

	/** The value stored now, read when called (never a render's copy). */
	const current = useCallback(
		<K extends Key>(key: K): GeneralSettings[K] | undefined =>
			utils.settings.getGeneral.getData()?.[key],
		[utils],
	);

	return {
		settings: query.data,
		isLoading: query.isLoading,
		isError: query.isError,
		refetch: query.refetch,
		update,
		current,
	};
}

export type GeneralSettingsApi = Pick<
	ReturnType<typeof useGeneralSettings>,
	"update" | "current"
>;

/**
 * Saves one general setting with the page's toast and Undo: the old value
 * is read when the change is made, and a change made while the same field
 * is still saving is dropped (one change, one write, one toast).
 */
export function useSaveSetting({ update, current }: GeneralSettingsApi) {
	const save = useAutosave();
	const guard = useSaveGuard();
	return useCallback(
		<K extends Key>(
			key: K,
			next: NonNullable<GeneralPatch[K]>,
			opts: { message?: string; fallback?: NonNullable<GeneralPatch[K]> } = {},
		) =>
			guard(key, () => {
				const prev = (current(key) ?? opts.fallback) as
					| NonNullable<GeneralPatch[K]>
					| undefined;
				return save({
					apply: (value: NonNullable<GeneralPatch[K]> | undefined) =>
						update({ [key]: value } as GeneralPatch),
					next,
					prev,
					message: opts.message,
					// Not loaded yet: nothing known to go back to.
					undoable: prev !== undefined,
				});
			}),
		[current, guard, save, update],
	);
}
