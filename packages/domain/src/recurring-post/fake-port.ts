/**
 * An in-memory store that posts a template the way the server's confirm and
 * skip do: read the template, plan, compare-and-set on the due date, advance it
 * and book the row. It is the test double for the plan-post core (the server's
 * Postgres and the device's store are the real ones), so the rules are proved
 * against one adapter that holds none of them itself. Not for production code.
 *
 * Hooks stand in for another client acting at a chosen step: `beforeWrite`
 * runs after a period is planned and before its compare-and-set, `afterPost`
 * after a period is booked and before the next protection read.
 */
import {
	MissingRateError,
	pickBestRate,
	type RateRow,
	rateWindow,
} from "../money";
import type { BookContext } from "../rate-booking";
import { preferredRateType } from "../rate-booking";
import type { RecurringEntryRow } from "./entry-row";
import {
	type CatchUpPort,
	type ConfirmInput,
	type ConfirmPlan,
	lostAdvance,
	type PostTemplate,
	planConfirm,
	planSkip,
	type SkipInput,
	type SkipPlan,
} from "./plan";
import { RecurringRefusal } from "./refusals";

export interface FakeRate {
	readonly currency: string;
	readonly type: string;
	readonly date: Date;
	readonly rate: number;
}

export interface FakeStoreInit {
	readonly template: Omit<PostTemplate, "stamp">;
	readonly homeCurrency: string;
	/** Rate type per home currency, as the user's settings hold them. */
	readonly preferred: Readonly<Record<string, string>>;
	readonly rates: readonly FakeRate[];
	readonly zone: string;
	/** Who is calling; the template may belong to someone else. */
	readonly caller: string;
	/** The template's name, which the adapter adds as the title. */
	readonly name?: string;
}

export interface FakeExpense extends RecurringEntryRow {
	readonly id: string;
	readonly title: string;
}

/** The sweep's words for what a period came to. */
export type FakeOutcome = "raced" | "missingRate";

export class FakeStore {
	template: PostTemplate;
	readonly expenses: FakeExpense[] = [];
	readonly zone: string;
	readonly caller: string;
	readonly book: BookContext;
	protectedAccount = false;
	/**
	 * Currency and date the rate lookup finds nothing for. A real table cannot
	 * leave a gap in the middle of a catch-up (the lookup falls back to the
	 * nearest row), so a gap is only reachable by cutting the lookup.
	 */
	missing?: (currency: string, date: Date) => boolean;
	beforeWrite?: () => void;
	afterPost?: () => void;
	private version = 1;
	private readonly name: string;

	constructor(init: FakeStoreInit) {
		this.template = { ...init.template, stamp: this.stampOf(1) };
		this.zone = init.zone;
		this.caller = init.caller;
		this.name = init.name ?? "Rent";
		this.book = {
			homeCurrency: init.homeCurrency,
			preferred: preferredRateType(init.homeCurrency, init.preferred),
			find: (currency, date, type) => {
				if (this.missing?.(currency, date)) return null;
				const rows: RateRow[] = init.rates.filter(
					(r) => r.currency === currency,
				);
				return pickBestRate(rateWindow(rows, date), {
					date,
					preferredType: type,
				});
			},
		};
	}

	private stampOf = (n: number) => `v${n}`;

	/** Another client changes the template: the stamp moves, as updatedAt does. */
	edit(patch: Partial<Omit<PostTemplate, "stamp">>) {
		this.version += 1;
		this.template = {
			...this.template,
			...patch,
			stamp: this.stampOf(this.version),
		};
	}

	/** The clock and zones of a call: the saved zone for both unless the request says another. */
	private timing(now: Date) {
		return {
			userId: this.caller,
			now,
			zone: this.zone,
			stepZone: this.zone,
		};
	}

	async confirm(
		now: Date,
		input: Partial<ConfirmInput> = {},
	): Promise<ConfirmPlan> {
		const plan = await planConfirm(
			this.template,
			{ ...this.timing(now), ...input },
			this.book,
		);
		this.beforeWrite?.();
		this.advance(plan, "confirm", input.expectedStamp);
		this.expenses.push({
			...plan.entry,
			id: `e${this.expenses.length + 1}`,
			title: this.name,
		});
		return plan;
	}

	skip(now: Date, input: Partial<SkipInput> = {}): SkipPlan {
		const plan = planSkip(this.template, { ...this.timing(now), ...input });
		this.beforeWrite?.();
		this.advance(plan, "skip", input.expectedStamp);
		return plan;
	}

	/**
	 * The compare-and-set, as the server's: moves the template only while it is
	 * still on the due date read and, when the caller named one, still has the
	 * stamp it saw.
	 */
	private advance(
		plan: ConfirmPlan | SkipPlan,
		call: "confirm" | "skip",
		expectedStamp: string | null | undefined,
	) {
		const t = this.template;
		if (
			t.nextDueDate.getTime() !== plan.dueAt.getTime() ||
			(expectedStamp && t.stamp !== expectedStamp)
		)
			throw lostAdvance(call, t, plan.dueAt, expectedStamp);
		this.edit({ nextDueDate: plan.nextDueDate, anchorDay: plan.anchorDay });
	}

	/** The sweep's view of this store: each period an auto confirm, reported rather than thrown. */
	catchUpPort(now: Date): CatchUpPort<FakeOutcome> {
		return {
			isProtected: async () => this.protectedAccount,
			post: async ({ dueAt }) => {
				try {
					const plan = await this.confirm(now, { dueAt, auto: true });
					this.afterPost?.();
					return { posted: true, nextDueDate: plan.nextDueDate };
				} catch (error) {
					if (error instanceof RecurringRefusal)
						return { posted: false, outcome: "raced" };
					if (error instanceof MissingRateError)
						return { posted: false, outcome: "missingRate" };
					throw error;
				}
			},
		};
	}
}
