import type { RetrospendClient } from "@retrospend/api-client";
import type { PosterEntry } from "@retrospend/domain/recurring-post/poster";
import type { PosterTemplatePlan } from "@retrospend/engine/device";
import type { DevicePoster } from "@/data/device-engine";
import { devicePoster } from "@/data/deviceWrites";
import { newClientId } from "@/data/ids";
import type { NewOutboxEntry, Outbox } from "@/data/outbox";
import { transportFor } from "@/data/transport";
import { deviceOf, exclusive, flushEntries } from "@/features/entry/queue";
import type { RecurringPayload } from "@/features/entry/send";
import { serverAutoConfirm, serverAutoPost } from "@/lib/server-info";
import type { PushEnabled } from "@/push/enabled";
import { withTimeout } from "./deviceSettle";

// The phone's recurring poster, under the dev flag: for each auto-pay expense
// template that is due, the domain plans every missed period (the engine's
// `planPoster`), and each period is queued as one confirm with origin
// "poster", the entry's due date and the stamp chain. The send goes through
// the one outbox flush, so the server's compare-and-set and its typed answers
// settle a plan that went stale. The server's sweep keeps posting for the
// accounts the phone leaves alone; whichever posts first wins, and the other
// retires (raced and recurring_already_posted).
//
// One run at a time with every flush and undo: the whole plan-and-queue step
// runs inside `exclusive` (queue.ts), the outbox's one lock. Pulls are not on
// that lock; the engine refuses to plan or book across one (`planPoster` and
// `book` answer null when a pull began), and a run stops at the first pull
// that begins, leaving the rest of its periods to the next run.

/** Why a run queued nothing, or stopped. */
export type PosterOutcome =
	| { status: "off" }
	/** The server's setting says nothing posts on its own (or it could not be read). */
	| { status: "auto_post_off" }
	/** Advanced protection is on, or could not be read: fail closed. */
	| { status: "protected" }
	/** The engine has no whole copy yet, or a pull began during the plan. */
	| { status: "not_ready" }
	| { status: "ran"; queued: number; stoppedByPull: boolean };

/**
 * Whether the account has protection keys. No keys (404) is the only "no":
 * any other answer, or none, counts as protected, so a phone that cannot ask
 * never posts for an account it cannot read.
 */
export async function readProtected(api: RetrospendClient): Promise<boolean> {
	try {
		await withTimeout((options) => api.protection.keys(undefined, options));
		return true;
	} catch (error) {
		return (error as { status?: unknown } | null)?.status !== 404;
	}
}

/**
 * What the server says about auto posting: its setting, and whether its
 * confirm takes `auto` (which recurring income needs). Any failure reads as
 * off for both.
 */
export async function readServerAuto(
	api: RetrospendClient,
): Promise<{ autoPost: boolean; income: boolean }> {
	try {
		const info = await withTimeout((options) =>
			api.platform.serverInfo(undefined, options),
		);
		return {
			autoPost: serverAutoPost(info),
			income: serverAutoConfirm(info),
		};
	} catch {
		return { autoPost: false, income: false };
	}
}

/**
 * A poster entry for the outbox: the base is the template's pulled version
 * (the first entry of a run) or the earlier entry of the run, named by its
 * client id. The type has no null base; `PosterEntry` itself cannot be made
 * without a stamp (the domain's `posterEntry`), and `Outbox.enqueue` refuses a
 * null base of origin "poster" at runtime (`assertStamped`).
 */
export type PosterOutboxEntry = NewOutboxEntry & {
	origin: "poster";
	baseVersion: string | { after: string };
};

function baseOf(
	stamp: PosterEntry["expectedStamp"],
	clientIds: readonly string[],
): string | { after: string } {
	if ("version" in stamp) return stamp.version;
	const earlier = clientIds[stamp.after];
	if (!earlier)
		throw new Error("A poster entry's chain names an entry that is not there");
	return { after: earlier };
}

export function posterOutboxEntry(
	entry: PosterEntry,
	plan: Pick<PosterTemplatePlan, "title" | "currency">,
	clientIds: readonly string[],
): PosterOutboxEntry {
	const clientId = clientIds[entry.index];
	if (!clientId) throw new Error("A poster entry needs a client id");
	const stamp = entry.expectedStamp;
	const baseVersion = baseOf(stamp, clientIds);
	const payload: RecurringPayload = {
		dueAt: entry.dueAt.toISOString(),
		title: plan.title,
		currency: plan.currency,
	};
	return {
		clientId,
		entity: "recurring",
		kind: "confirm",
		targetId: entry.templateId,
		baseVersion,
		payload,
		origin: "poster",
	};
}

/**
 * Books and queues one template's periods in order. Stops, leaving the rest
 * for the next run, when a pull began (the plan was made over older rows) or
 * the device could not book a period (never queued unbooked: the poster's
 * entry always carries its booking).
 */
async function queueTemplate(
	plan: PosterTemplatePlan,
	device: DevicePoster,
	outbox: Outbox,
	pullsAtStart: number,
): Promise<{ queued: number; stoppedByPull: boolean }> {
	const clientIds = plan.run.entries.map(() => newClientId());
	let queued = 0;
	for (const entry of plan.run.entries) {
		if (device.pullsBegun() !== pullsAtStart)
			return { queued, stoppedByPull: true };
		const entryBase = posterOutboxEntry(entry, plan, clientIds);
		const booked = await device.book({
			kind: "confirm",
			body: {
				templateId: entry.templateId,
				dueAt: entry.dueAt.toISOString(),
				expenseId: entryBase.clientId,
				// The server books the entry as its sweep does, income too.
				auto: true,
			},
		});
		if (!booked) return { queued, stoppedByPull: false };
		await outbox.enqueue({ ...entryBase, device: deviceOf(booked) });
		await device.refresh().catch(() => undefined);
		queued += 1;
	}
	return { queued, stoppedByPull: false };
}

export interface PosterRunInput {
	api: RetrospendClient;
	outbox: Outbox;
	/** Stops the send when the account changed. */
	signal?: AbortSignal;
}

/**
 * One poster run: on app open (after the pull settles) and from the Android
 * background task. Does nothing without the flag and a running engine.
 */
export async function runPoster(input: PosterRunInput): Promise<PosterOutcome> {
	const { api, outbox } = input;
	const device = devicePoster(api);
	if (!device) return { status: "off" };

	// Read before the plan, never inside it: the plan holds the store open.
	const { autoPost, income } = await readServerAuto(api);
	if (!autoPost) return { status: "auto_post_off" };
	const isProtected = await readProtected(api);
	if (isProtected) return { status: "protected" };

	const outcome = await exclusive(outbox, async (): Promise<PosterOutcome> => {
		const pullsAtStart = device.pullsBegun();
		// A template with an entry the phone has not seen back is left alone:
		// its pull has not come, so the plan would repeat the periods.
		const { open, acked } = await outbox.snapshot();
		const busy = new Set(
			[...open, ...acked]
				.filter((e) => e.entity === "recurring")
				.map((e) => e.targetId),
		);
		const plans = await device.planPoster({
			autoPost,
			income,
			isProtected: async () => isProtected,
			skip: busy,
		});
		if (!plans) return { status: "not_ready" };
		let queued = 0;
		for (const plan of plans) {
			const done = await queueTemplate(plan, device, outbox, pullsAtStart);
			queued += done.queued;
			if (done.stoppedByPull)
				return { status: "ran", queued, stoppedByPull: true };
		}
		return { status: "ran", queued, stoppedByPull: false };
	});
	if (outcome.status === "ran" && outcome.queued > 0)
		await flushEntries(outbox, api, transportFor(api), {
			...(input.signal ? { signal: input.signal } : {}),
		}).catch(() => undefined);
	return outcome;
}

/** Who the background task posts for: the account that armed it (the push record's shape). */
export type PosterWho = PushEnabled;

export type PosterTaskOutcome =
	| PosterOutcome
	| { status: "skipped"; why: "nobody" | "other_account" | "app_open" };

export interface PosterTaskDeps {
	who(): Promise<PosterWho | null>;
	/** Who is signed in on that server (the cached profile), or null. */
	signedInAs(baseUrl: string): Promise<string | null>;
	/** Drops the record of an account whose session is gone. */
	forget(who: PosterWho): Promise<void>;
	/** The app is on screen: its own poster runs, and no second engine opens the same file. */
	appActive(): boolean;
	run(who: PosterWho): Promise<PosterOutcome>;
}

/**
 * One background run, like `runPoll`: everything it needs is passed in, so
 * the real task (posterTask.android.ts) and the tests use the same code.
 */
export async function runPosterTask(
	deps: PosterTaskDeps,
): Promise<PosterTaskOutcome> {
	const who = await deps.who();
	if (!who) return { status: "skipped", why: "nobody" };
	// Another account (or nobody) holds this server's token now: never post
	// for the account that armed the task.
	if ((await deps.signedInAs(who.baseUrl)) !== who.meId) {
		await deps.forget(who);
		return { status: "skipped", why: "other_account" };
	}
	if (deps.appActive()) return { status: "skipped", why: "app_open" };
	return deps.run(who);
}
