import type { RetrospendClient } from "@retrospend/api-client";
import type {
	DeviceBudget,
	DeviceRead,
	DeviceReads,
} from "@/data/device-engine";
import type { CacheKey } from "@/features/read/loadCached";

// The Budget reads, all from API v1. Shapes are the contract's own, so a
// server change shows up here as a type error. Every figure on the screen is
// one of these fields: the phone words and formats them, it never adds them.

type Client = RetrospendClient["budget"];

export type BudgetMonth = NonNullable<Awaited<ReturnType<Client["month"]>>>;
export type BudgetGroup = BudgetMonth["groups"][number];
export type BudgetEnvelope = BudgetGroup["envelopes"][number];
export type Verdict = BudgetMonth["verdict"];
export type BudgetStyle = BudgetMonth["book"]["style"];
export type FillPlan = Awaited<ReturnType<Client["fillFromTargets"]>>;
export type CoverOverview = Awaited<ReturnType<Client["coverSources"]>>;
export type BudgetPreview = Awaited<ReturnType<Client["previewAssign"]>>;
export type PayoffProjection = Awaited<ReturnType<Client["payoffProjection"]>>;

/** The month the server calls current, or the one asked for. */
export interface BudgetRead {
	/** Null: there is no budget yet (the person never set one up). */
	month: BudgetMonth | null;
	/** Pay off debt books: the server's projection (debt-free month, total debt); null when it did not load. */
	payoff: PayoffProjection | null;
}

export const BUDGET_CACHE_PREFIX = "budget.month.";
export const BUDGET_CACHE_KEEP = 14;

/** One cache entry per month; `null` is the current month. */
export function budgetCache(month: number | null): CacheKey {
	return { name: `${BUDGET_CACHE_PREFIX}${month ?? "current"}`, schema: 2 };
}

const ASK = { fresh: true, budget: true } as const;

/**
 * The device's budget month when it describes the same month of the same book
 * on the same day as the server's, in the same currency and style, with
 * neither side incomplete or approximate and a style that leads with the
 * BudgetHero (Pay off debt has its own). Null for any doubt: then the two are
 * not comparable.
 */
export function comparableBudget(
	data: BudgetMonth | null,
	read: DeviceRead | null,
): DeviceBudget | null {
	const device = read?.budget;
	if (!data || !read?.budgetReady || !device) return null;
	const same =
		device.bookId === data.book.id &&
		device.currency === data.book.currency &&
		device.month === data.month.key &&
		device.today === data.today &&
		device.verdict.style === data.verdict.style;
	const whole = !(
		data.incomplete ||
		data.verdict.incomplete ||
		data.approximate ||
		device.incomplete ||
		device.verdict.incomplete ||
		device.approximate
	);
	return same && whole && data.book.style !== "DEBT_PAYOFF" ? device : null;
}

/** What differs between two comparable verdicts: state, action, the lead's figure and its amount. */
export function verdictParts(device: Verdict, server: Verdict): string[] {
	const parts: string[] = [];
	if (device.state !== server.state) parts.push("state");
	if (device.action !== server.action) parts.push("action");
	if (device.lead.figureId !== server.lead.figureId) parts.push("figure");
	if (
		device.lead.amount.minor !== server.lead.amount.minor ||
		device.lead.amount.currency !== server.lead.amount.currency
	)
		parts.push("amount");
	return parts;
}

/**
 * Holds the device's verdict against the server's. A difference may be a
 * change the sync feed holds back for a moment, so the device pulls once more
 * and reads again; a verdict that still differs is reported (ids and parts,
 * never amounts). It only observes: nothing on screen reads its result.
 */
async function checkVerdict(
	device: DeviceReads,
	data: BudgetMonth | null,
	first: DeviceRead | null,
): Promise<void> {
	const before = comparableBudget(data, first);
	if (
		!data ||
		!before ||
		verdictParts(before.verdict, data.verdict).length === 0
	)
		return;
	const again = comparableBudget(data, await device.read([], ASK));
	if (!again) return;
	const parts = verdictParts(again.verdict, data.verdict);
	if (parts.length > 0)
		device.reportVerdict(data.verdict.lead.figureId, parts, {
			device: again.verdict,
			server: data.verdict,
		});
}

/**
 * Only the default read (the current month, `month` null) is held against the
 * device, which pulls fresh for it; an explicit month, the current one
 * included, never is. The check runs on its own: the screen shows the
 * server's answer as soon as it has it.
 */
export function fetchBudget(
	api: RetrospendClient,
	month: number | null,
	device?: DeviceReads | null,
) {
	return async (): Promise<BudgetRead> => {
		const source = month === null ? (device ?? null) : null;
		const read = source ? source.read([], ASK).catch(() => null) : null;
		const data = await api.budget.month(month === null ? {} : { month });
		// Pay off debt leads with the debt-free month, a read of its own.
		const payoff =
			data?.book.style === "DEBT_PAYOFF"
				? await api.budget.payoffProjection({}).catch(() => null)
				: null;
		if (source && read)
			void read
				.then((first) => checkVerdict(source, data, first))
				.catch(() => undefined);
		return { month: data, payoff };
	};
}

/** The envelope rows of a month in the order the page lists them. */
export function envelopesOf(data: BudgetMonth): BudgetEnvelope[] {
	return data.groups.flatMap((g) => g.envelopes);
}

export function envelopeById(
	data: BudgetMonth,
	id: string | null,
): BudgetEnvelope | null {
	if (!id) return null;
	return envelopesOf(data).find((e) => e.id === id) ?? null;
}
