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
 */

/** The host a cap counts a user-chosen URL under: its last two labels, or null when it is not a URL. */
export function capHostOf(endpoint: string | null): string | null {
	if (!endpoint) return null;
	let hostname: string;
	try {
		hostname = new URL(endpoint).hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return null;
	}
	// An address (or a bracketed IPv6 one) is its own host.
	if (/^[\d.]+$/.test(hostname) || hostname.startsWith("[")) return hostname;
	return hostname.split(".").slice(-2).join(".");
}

export type Limits = { total: number; perUser: number; perHost: number };

/** What a job counts against. A null host is not capped. */
export type Slot = { user: string; host: string | null };

function bump(counts: Map<string, number>, key: string, by: 1 | -1): void {
	const next = (counts.get(key) ?? 0) + by;
	if (next > 0) counts.set(key, next);
	else counts.delete(key);
}

/**
 * Runs `run` for every item within the limits and resolves when all have
 * finished. A job that throws frees its slot, the rest still run, and the
 * first failure is thrown at the end.
 */
export function runWithLimits<T>(
	items: readonly T[],
	slotOf: (item: T) => Slot,
	limits: Limits,
	run: (item: T) => Promise<void>,
): Promise<void> {
	const waiting = [...items];
	const users = new Map<string, number>();
	const hosts = new Map<string, number>();
	const failures: unknown[] = [];
	let active = 0;

	return new Promise<void>((resolve, reject) => {
		const pump = () => {
			for (let i = 0; i < waiting.length && active < limits.total; ) {
				const item = waiting[i] as T;
				const { user, host } = slotOf(item);
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
						pump();
					});
			}
			if (waiting.length === 0 && active === 0) {
				if (failures.length > 0) reject(failures[0]);
				else resolve();
			}
		};
		pump();
	});
}
