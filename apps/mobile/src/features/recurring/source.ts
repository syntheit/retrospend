import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceReads } from "@/data/device-engine";
import type { CacheKey } from "@/features/read/loadCached";

// Recurring reads, all from API v1: the templates (next due first) and what
// they cost per period. The cost, the due states and the next dates are the
// server's; the phone groups and shows them.

type Client = RetrospendClient["recurring"];

export type RecurringItem = Awaited<
	ReturnType<Client["list"]>
>["items"][number];
export type RecurringSummary = Awaited<ReturnType<Client["summary"]>>;

export interface RecurringData {
	items: RecurringItem[];
	summary: RecurringSummary;
}

export const RECURRING_CACHE: CacheKey = { name: "recurring", schema: 1 };

/** The device's figures are only checked against the server's, with the template ids the screen lists; it shows the server's numbers (AGENTS 6.1). */
export function fetchRecurring(
	api: RetrospendClient,
	device?: DeviceReads | null,
) {
	return async (): Promise<RecurringData> => {
		const [page, summary] = await Promise.all([
			api.recurring.list({ limit: 100 }),
			api.recurring.summary(),
		]);
		if (device)
			void device.compare("recurring", {
				recurringId: page.items.map((i) => i.id),
			});
		return { items: page.items, summary };
	};
}
