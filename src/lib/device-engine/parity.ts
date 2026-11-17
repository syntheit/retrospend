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
		storedZone: string | null;
		browserZone: string | null;
	},
): ParityReport {
	return {
		state,
		...parts,
		zoneDiffers:
			parts.storedZone !== null &&
			parts.browserZone !== null &&
			parts.storedZone !== parts.browserZone,
	};
}

/**
 * The api, telling `record` the time zone of each settings snapshot it
 * returns. The server buckets days and months in the zone of the request (the
 * x-timezone header, else the tz cookie the browser sends) before the stored
 * one, so a check against it must name the stored zone the engine reads in.
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

/** The header the server reads a request's zone from. */
export const ZONE_HEADER = "x-timezone";

/** A request to the figures route, which reads days and months in a zone. */
export const isFiguresRequest = (url: string) =>
	new URL(url, "http://localhost").pathname.endsWith("/figures");
