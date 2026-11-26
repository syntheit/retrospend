/**
 * What a device's poster plans for one template: every due period, as entries
 * to queue. Nothing is written here; each entry is one confirm for a later
 * send, in order.
 *
 * A transport cannot say "auto" (the server's confirm takes it from the sweep
 * only), so on the plain path the template stamp is the only guard against
 * posting after the web turned auto-pay off or switched to ASK. A poster entry
 * therefore always carries one: `PosterEntry.expectedStamp` is not optional, and
 * `posterEntry` is the one place that builds it.
 *
 * An income template plans like an expense one, through the same `planConfirm`
 * the server's sweep runs: a row only (direction IN, inType INCOME), no account
 * leg, due by the start of the next day in the saved zone.
 */
import { MissingRateError } from "../money";
import type { BookContext } from "../rate-booking";
import {
	type CatchUpStop,
	type ConfirmPlan,
	type PostTemplate,
	planConfirm,
	protectionStop,
	readProtection,
	runCatchUp,
} from "./plan";
import { RecurringRefusal, type RecurringRefusalKind } from "./refusals";

/**
 * The template version an entry expects: the one the device pulled (the first
 * entry of a run), or the version an earlier entry of the same run leaves
 * behind, named by its index, which the send fills in from that entry's ack.
 */
export type PosterStamp =
	| { readonly version: string }
	| { readonly after: number };

/**
 * The enqueue (slice-device-recurring.md, PR12) maps `expectedStamp` onto the
 * outbox's own base version and must keep this required-stamp guard for
 * origin "poster": an entry with no stamp is never queued.
 */
export interface PosterEntry {
	readonly origin: "poster";
	readonly templateId: string;
	/** Position in the run, from 0. */
	readonly index: number;
	readonly dueAt: Date;
	readonly plan: ConfirmPlan;
	readonly expectedStamp: PosterStamp;
}

export class PosterStampError extends Error {
	override readonly name = "PosterStampError";
}

/** A poster entry; it cannot be made without a stamp. */
export function posterEntry(
	plan: ConfirmPlan,
	index: number,
	expectedStamp: PosterStamp,
): PosterEntry {
	const stamp = expectedStamp as Partial<{ version: string; after: number }>;
	const named =
		typeof stamp?.version === "string"
			? stamp.version !== ""
			: Number.isInteger(stamp?.after) && (stamp?.after ?? -1) >= 0;
	if (!named)
		throw new PosterStampError("A poster entry needs a template stamp");
	return {
		origin: "poster",
		templateId: plan.templateId,
		index,
		dueAt: plan.dueAt,
		plan,
		expectedStamp,
	};
}

export interface PosterRunInput {
	readonly userId: string;
	/** The template as last pulled; null when it is gone. */
	readonly template: PostTemplate | null;
	/** The server's auto-post setting: off means the server posts nothing, and so does the poster. */
	readonly autoPost: boolean;
	readonly now: Date;
	/** The saved zone: a poster reads "is it due" and steps in it, never in the phone's own zone. */
	readonly zone: string;
	readonly book: BookContext;
	readonly isProtected: () => Promise<boolean>;
}

/**
 * - `auto_post_off`: the server's setting says nothing posts on its own.
 * - `no_stamp`: the template has no version to name yet (made on this device,
 *   not yet acknowledged), so no entry could carry the guard.
 * - `protected`, `protection_unreadable`: protection is on, or could not be
 *   read (which fails closed but is reported apart, for the caller to log).
 * - the rest are runCatchUp's: `caught_up`, `refused` (see `refusal`), `cap`.
 */
export type PosterStop = CatchUpStop | "auto_post_off" | "no_stamp";

export interface PosterRun {
	readonly entries: readonly PosterEntry[];
	readonly stopped: PosterStop;
	/** Why the period after the last entry did not plan, when `stopped` is `refused`. */
	readonly refusal?: RecurringRefusalKind | "missing_rate";
}

const none = (
	stopped: PosterStop,
	refusal?: PosterRun["refusal"],
): PosterRun => ({ entries: [], stopped, ...(refusal && { refusal }) });

export async function planPosterRun(input: PosterRunInput): Promise<PosterRun> {
	if (!input.autoPost) return none("auto_post_off");
	const stamp = input.template?.stamp;
	if (!input.template) return none("refused", "not_found");
	if (!stamp) return none("no_stamp");
	const stop = protectionStop(await readProtection(input.isProtected));
	if (stop) return none(stop);

	const entries: PosterEntry[] = [];
	let working: PostTemplate = input.template;
	const run = await runCatchUp<RecurringRefusalKind | "missing_rate">(
		{
			isProtected: input.isProtected,
			post: async ({ dueAt, index }) => {
				try {
					const plan = await planConfirm(
						working,
						{
							userId: input.userId,
							now: input.now,
							zone: input.zone,
							stepZone: input.zone,
							dueAt,
							auto: true,
						},
						input.book,
					);
					entries.push(
						posterEntry(
							plan,
							index,
							index === 0 ? { version: stamp } : { after: index - 1 },
						),
					);
					working = {
						...working,
						nextDueDate: plan.nextDueDate,
						anchorDay: plan.anchorDay,
					};
					return { posted: true, nextDueDate: plan.nextDueDate };
				} catch (error) {
					if (error instanceof RecurringRefusal)
						return { posted: false, outcome: error.kind };
					if (error instanceof MissingRateError)
						return { posted: false, outcome: "missing_rate" };
					throw error;
				}
			},
		},
		input.template.nextDueDate,
		input.now,
	);
	const last = run.results.at(-1);
	return {
		entries,
		stopped: run.stopped,
		...(last && !last.posted && { refusal: last.outcome }),
	};
}
