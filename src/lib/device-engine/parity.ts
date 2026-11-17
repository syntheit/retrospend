import type { DeviceRead } from "@retrospend/engine/device";
import type { HostApi } from "./host";
import type { ParityReport } from "./protocol";

/**
 * The glance figures the device computes and the web checks against the
 * server. Never owed (the engine has no shares figure) and never
 * rate.dollarToday: those stay the server's. The phone's rule
 * (apps/mobile/src/features/home/source.ts) is the same list.
 */
export const GLANCE_PARITY_IDS: readonly string[] = [
	"glance.spent",
	"glance.spentLastToDate",
	"glance.spentLast",
	"netWorth",
	"glance.moneyIn",
];

/** Not planned yet counts only while the device can read the budget block. */
export const NOT_PLANNED_YET = "budget.notPlannedYet";

/** What to ask the engine for: the glance ids, and Not planned yet. Only those it then has a reading for are checked. */
export const idsToRead = (base: readonly string[]) => [
	...base,
	NOT_PLANNED_YET,
];

/** The ids to check against the server, from what the engine read. */
export function idsToCheck(
	read: DeviceRead,
	base: readonly string[],
): string[] {
	return [
		...base.filter((id) => read.readings.has(id)),
		...(read.budgetReady && read.readings.has(NOT_PLANNED_YET)
			? [NOT_PLANNED_YET]
			: []),
	];
}

export function reportOf(
	state: ParityReport["state"],
	parts: Pick<ParityReport, "ids" | "mismatchedIds" | "generation"> & {
		counts?: ParityReport["counts"];
		storedZone: string | null;
		browserZone: string | null;
	},
): ParityReport {
	return {
		state,
		counts: [],
		...parts,
		zoneDiffers:
			parts.storedZone !== null &&
			parts.browserZone !== null &&
			parts.storedZone !== parts.browserZone,
	};
}

/**
 * The api, telling `record` the time zone of each settings snapshot it
 * returns. The server's figures route reads days and months in the stored
 * zone, whatever zone the request names, so this is the zone both sides of a
 * check read in. The tRPC Home on screen reads in the browser's zone instead,
 * which L6a must match when the device's figures replace it.
 */
export function recordingZone(
	api: HostApi,
	record: (zone: string) => void,
): HostApi {
	return new Proxy(api, {
		get(target, key) {
			const value = Reflect.get(target, key);
			if (key !== "sync") return value;
			return new Proxy(value as HostApi["sync"], {
				get(sync, name) {
					const route = Reflect.get(sync, name);
					if (name !== "settings") return route;
					return async () => {
						const settings = await (route as HostApi["sync"]["settings"])();
						if (typeof settings?.timeZone === "string")
							record(settings.timeZone);
						return settings;
					};
				},
			});
		},
	});
}

const linesIn = (value: unknown) =>
	Array.isArray(value) ? value.length : null;

/**
 * How many lines each side holds for each checked figure. `read` is the
 * device's reading when the check began; a figure that differed after the
 * engine's second pull takes both counts from that last comparison instead.
 */
export function countsOf(
	ids: readonly string[],
	read: DeviceRead,
	mismatches: readonly { id: string; device: unknown; server: unknown }[],
): ParityReport["counts"] {
	return ids.map((id) => {
		const differing = mismatches.find((m) => m.id === id);
		if (differing)
			return {
				id,
				device: linesIn(differing.device),
				server: linesIn(differing.server),
			};
		const lines = linesIn(read.readings.get(id));
		return { id, device: lines, server: lines };
	});
}
