import type { RetrospendClient } from "@retrospend/api-client";
import type { VerdictView } from "@retrospend/engine/device";
import type { DeviceReads } from "@/data/device-engine";
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

/**
 * The verdict as the compare holds it, from the server's month. A month that
 * is incomplete or approximate is marked so on the verdict itself, which the
 * compare then leaves out.
 */
export function verdictViewOf(data: BudgetMonth): VerdictView {
	const { verdict } = data;
	return {
		bookId: data.book.id,
		currency: data.book.currency,
		month: data.month.key,
		today: data.today,
		style: verdict.style,
		incomplete: data.incomplete || verdict.incomplete || data.approximate,
		state: verdict.state,
		action: verdict.action,
		lead: { figureId: verdict.lead.figureId, amount: verdict.lead.amount },
	};
}

/**
 * Only the default read (the current month, `month` null) is held against the
 * device (`compare`, with the verdict read again through this screen's own
 * query); an explicit month, the current one included, never is. The check runs
 * on its own: the screen shows the server's answer as soon as it has it.
 */
export function fetchBudget(
	api: RetrospendClient,
	month: number | null,
	device?: DeviceReads | null,
) {
	return async (): Promise<BudgetRead> => {
		const data = await api.budget.month(month === null ? {} : { month });
		// Pay off debt leads with the debt-free month, a read of its own.
		const payoff =
			data?.book.style === "DEBT_PAYOFF"
				? await api.budget.payoffProjection({}).catch(() => null)
				: null;
		if (month === null && device)
			void device.compare("budget", {}, async () => {
				const again = await api.budget.month({});
				return again ? verdictViewOf(again) : null;
			});
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
