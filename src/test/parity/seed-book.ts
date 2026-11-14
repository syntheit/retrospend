/**
 * The budget book of the parity ledger (E2EE P13b): a personal book that began
 * 24 months before the first clock, about 30 envelopes in three groups (five of
 * them fed by the ledger's categories, one a savings goal), 500 movements
 * spread over every month, a Wealth move, and the months before the first
 * clock closed (the first read writes their checkpoints). The ledger's own
 * expenses, shares and accounts (it has a card and a loan) are the book's rows.
 *
 * Set up in the past with only Date faked, as seedBudgetBook does, and read once
 * at the first clock; the caller's clock is the real one again afterwards. The
 * setup comes before the ledger's rows (`seedParityBook`) and the movements and
 * closes after them (`ParityBook.finish`).
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import { ensureMonthsClosed } from "~/server/services/envelope/month-close.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { runFreeze } from "~/server/services/sync/budget-block";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { adminDb } from "../pg-harness";
import { chunks, D, DAY, type SeedContext } from "./seed-context";

const ENVELOPES = 30;
const MOVEMENTS = 500;
const MONTHS_BACK = 24;

function setupOf(ctx: SeedContext): SetupInput {
	const feeds = (i: number) =>
		i < ctx.categoryIds.length ? [ctx.categoryIds[i] as string] : [];
	return {
		style: "FLEX",
		weekStartDay: 1,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
			{ key: "savings", name: "Savings", role: "SAVINGS" },
		],
		envelopes: Array.from({ length: ENVELOPES }, (_, i) => ({
			key: `e${i}`,
			name: `Envelope ${i}`,
			groupKey: i < 8 ? "bills" : i < 24 ? "spending" : "savings",
			kind: (i >= 24 ? "SAVINGS" : "MONTHLY") as "SAVINGS" | "MONTHLY",
			isDefault: i === 8,
			categoryIds: feeds(i),
			...(i < 24
				? {
						target: {
							kind: "MONTHLY" as const,
							amountMinor: 10_000 + i * 500,
							mode: i % 2 === 0 ? ("REFILL" as const) : ("SET_ASIDE" as const),
							cadence: "MONTH" as const,
						},
					}
				: {}),
		})),
	};
}

export interface ParityBook {
	bookId: string;
	envelopeIds: string[];
	/** Adds the movements and the Wealth move, then closes the months. Call it once the ledger's rows are in. */
	finish(): Promise<void>;
}

/** Runs `fn` with only Date faked at `at`, and the real clock again after. */
async function atDate<T>(at: Date, fn: () => Promise<T>): Promise<T> {
	vi.useFakeTimers({ toFake: ["Date"] });
	try {
		vi.setSystemTime(at);
		return await fn();
	} finally {
		vi.useRealTimers();
	}
}

/**
 * Sets the book up, 24 months before the first clock. Done before the ledger's
 * rows exist: setup reads the book it makes (in a page read's five seconds),
 * which at 10,000 rows it would not finish. `finish` does the rest.
 */
export async function seedParityBook(ctx: SeedContext): Promise<ParityBook> {
	const first = ctx.clocks[0] as Date;
	await atDate(new Date(first.getTime() - MONTHS_BACK * 30 * DAY), () =>
		forUser(ctx.userId).apply(setupEnvelopeBook, {
			...setupOf(ctx),
			currency: ctx.home,
			timeZone: resolveTimeZone(ctx.profile.timeZone),
		}),
	);
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: ctx.userId },
		include: { envelopes: true },
	});
	const envelopeIds = book.envelopes.map((e) => e.id);
	// An ARS book values its foreign rows at blue, so a rewritten blue rate is a rewrite the book reads.
	if (ctx.home === "ARS")
		await adminDb.bookPeriod.updateMany({
			where: { bookId: book.id },
			data: { rateType: "blue" },
		});
	const finish = async () => {
		const movements = Array.from({ length: MOVEMENTS }, (_, i) => {
			// A month key from the book's start month on, a few per envelope.
			const offset = i % MONTHS_BACK;
			const startYear = Math.floor(book.startMonth / 100);
			const month0 = (book.startMonth % 100) - 1 + offset;
			const month =
				(startYear + Math.floor(month0 / 12)) * 100 + (month0 % 12) + 1;
			return {
				id: randomUUID(),
				bookId: book.id,
				month,
				toEnvelopeId: ctx.pick(envelopeIds),
				amount: D(ctx.int(1, 500) * 100),
				kind: "ASSIGN" as const,
				actorUserId: ctx.userId,
			};
		});
		for (const part of chunks(movements, 250))
			await adminDb.budgetMovement.createMany({ data: part });
		await adminDb.wealthTransfer.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				direction: "TO_WEALTH",
				envelopeId: envelopeIds[24] as string,
				date: new Date(first.getTime() - 60 * DAY),
				amount: D(1_000),
				actorUserId: ctx.userId,
			},
		});
		// The first read values every row once and closes every month before this
		// one, keeping their checkpoints. At 10,000 rows that is longer than a page
		// read's five seconds, so the values are kept first (the device freeze has
		// thirty) and the months close in a transaction with room for them.
		await atDate(first, async () => {
			await runFreeze(adminDb, ctx.userId, { force: true });
			await userTransaction(
				adminDb,
				ctx.userId,
				(tx) => ensureMonthsClosed(tx, ctx.userId, first),
				{ timeout: 110_000 },
			);
		});
	};
	return { bookId: book.id, envelopeIds, finish };
}
