import { lockCredential } from "~/server/services/protection-keys/password-writes";
import type { Prisma } from "~prisma";
import { adminDb } from "~/test/pg-harness";

/**
 * Runs `run` while another transaction holds a lock, so that `run` has read
 * what it needs and is waiting at the lock; `work` writes in the holder, which
 * then commits, and `run` goes on to see the result. `lock` takes the lock in
 * the holder.
 */
export async function holdLock<T>(
	lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
	work: (tx: Prisma.TransactionClient) => Promise<void>,
	run: () => Promise<T>,
): Promise<T> {
	let locked!: () => void;
	const ready = new Promise<void>((resolve) => {
		locked = resolve;
	});
	const holder = adminDb.$transaction(
		async (tx) => {
			await lock(tx);
			locked();
			// Wait until the run's transaction is queued behind this lock.
			for (let i = 0; i < 600; i++) {
				const [row] = await adminDb.$queryRaw<{ n: number }[]>`
					SELECT count(*)::int AS n FROM pg_stat_activity
					WHERE datname = current_database() AND wait_event_type = 'Lock'`;
				if ((row?.n ?? 0) > 0) break;
				await new Promise((r) => setTimeout(r, 50));
			}
			await work(tx);
		},
		{ timeout: 60_000, maxWait: 60_000 },
	);
	await ready;
	const [result] = await Promise.all([run(), holder]);
	return result;
}

/** `holdLock` on the account's credential row. */
export const holdCredentialLock = <T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<void>,
	run: () => Promise<T>,
) => holdLock((tx) => lockCredential(tx, userId), work, run);

/** `holdLock` on the user's key set row, as a writer of the set holds it. */
export const holdSetLock = <T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<void>,
	run: () => Promise<T>,
) =>
	holdLock(
		(tx) =>
			tx.$queryRaw`SELECT "userId" FROM "protection_key_set" WHERE "userId" = ${userId} FOR UPDATE`,
		work,
		run,
	);
