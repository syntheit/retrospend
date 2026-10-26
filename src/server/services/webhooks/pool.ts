/**
 * A small concurrency pool with three caps: in flight overall, per user and
 * per host. The webhook and push workers send through it so that one
 * account, or one slow endpoint, cannot take the slots every other person's
 * delivery needs (a webhook URL or a UnifiedPush endpoint is an address a
 * user chose, and one that answers after ten seconds, or never, costs a slot
 * for that long).
 *
 * A job that cannot start yet (its user or host is at its cap) waits and
 * lets later jobs go ahead; it starts as soon as something it was waiting
 * on frees up. Otherwise jobs start in the order given.
 *
 * The pool can keep itself fed: when slots are free and nothing waiting can
 * use them, it asks `refill` for more work, so a person whose jobs are all
 * blocked behind their own slow ones does not hold up everyone else. A
 * `deadline` stops it from starting anything new after a wall-clock time
 * (what is running still finishes), so a sweep ends in bounded time.
 */

/**
 * The host a cap counts a user-chosen URL under: its exact host name,
 * lowercased and without a trailing dot, or the address itself (an IPv6
 * literal in the short form the URL parser gives). Null when it is not a
 * URL. Suffixes such as github.io or co.uk are not grouped: a name belongs
 * to whoever registered it, and the cap per account already limits one
 * person's many names.
 */
export function capHostOf(endpoint: string | null): string | null {
	if (!endpoint) return null;
	try {
		return new URL(endpoint).hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return null;
	}
}

export type Limits = { total: number; perUser: number; perHost: number };

/** What a job counts against. A null host is not capped. */
export type Slot = { user: string; host: string | null };

export type PoolOptions<T> = {
	/** What identifies a job, so work handed over twice runs once. Default: the item itself. */
	keyOf?: (item: T) => unknown;
	/** More work, asked for when slots are free and nothing waiting can use them. */
	refill?: () => Promise<readonly T[]>;
	/** Epoch milliseconds after which no new job starts. */
	deadline?: number;
};

function bump(counts: Map<string, number>, key: string, by: 1 | -1): void {
	const next = (counts.get(key) ?? 0) + by;
	if (next > 0) counts.set(key, next);
	else counts.delete(key);
}

/**
 * Runs `run` for every item within the limits and resolves when all have
 * finished. A job that throws, a `slotOf` that throws and a `refill` that
 * throws each free what they held, the rest still run, and the first failure
 * is thrown at the end.
 */
export function runWithLimits<T>(
	items: readonly T[],
	slotOf: (item: T) => Slot,
	limits: Limits,
	run: (item: T) => Promise<void>,
	options: PoolOptions<T> = {},
): Promise<void> {
	const { keyOf = (item: T) => item, refill, deadline } = options;
	const waiting: T[] = [];
	const seen = new Set<unknown>();
	const users = new Map<string, number>();
	const hosts = new Map<string, number>();
	const failures: unknown[] = [];
	let active = 0;
	let refilling = false;
	// The last pull found nothing new; a finished job may change that.
	let dry = !refill;

	const add = (more: readonly T[]): number => {
		let added = 0;
		for (const item of more) {
			const key = keyOf(item);
			if (seen.has(key)) continue;
			seen.add(key);
			waiting.push(item);
			added += 1;
		}
		return added;
	};
	add(items);

	return new Promise<void>((resolve, reject) => {
		const pump = () => {
			const late = deadline !== undefined && Date.now() >= deadline;
			for (let i = 0; !late && i < waiting.length && active < limits.total; ) {
				const item = waiting[i] as T;
				let slot: Slot;
				try {
					slot = slotOf(item);
				} catch (error) {
					failures.push(error);
					waiting.splice(i, 1);
					continue;
				}
				const { user, host } = slot;
				const blocked =
					(users.get(user) ?? 0) >= limits.perUser ||
					(host !== null && (hosts.get(host) ?? 0) >= limits.perHost);
				if (blocked) {
					i += 1;
					continue;
				}
				waiting.splice(i, 1);
				active += 1;
				bump(users, user, 1);
				if (host !== null) bump(hosts, host, 1);
				Promise.resolve()
					.then(() => run(item))
					.catch((error) => failures.push(error))
					.finally(() => {
						active -= 1;
						bump(users, user, -1);
						if (host !== null) bump(hosts, host, -1);
						dry = !refill;
						pump();
					});
			}
			// Free slots that nothing waiting can use: ask for more work.
			if (refill && !late && !refilling && !dry && active < limits.total) {
				refilling = true;
				refill()
					.then((more) => {
						dry = add(more) === 0;
					})
					.catch((error) => {
						failures.push(error);
						dry = true;
					})
					.finally(() => {
						refilling = false;
						pump();
					});
				return;
			}
			const nothingToStart = late || waiting.length === 0;
			if (nothingToStart && active === 0 && !refilling) {
				if (failures.length > 0) reject(failures[0]);
				else resolve();
			}
		};
		pump();
	});
}
