/**
 * The budget book of the parity ledger (E2EE P13b): a personal book that began
 * 24 months before the first clock, about 30 envelopes in three groups (five of
 * them fed by the ledger's categories, one a savings goal), 500 movements
 * spread over every month, a Wealth move, and the months before the first
 * clock closed (the first read writes their checkpoints). The ledger's own
 * expenses, shares and accounts (it has a card and a loan) are the book's rows.
 *
 * Set up in the past with only Date faked, as seedBudgetBook does, and read once
 * at the first clock; the caller's clock is the real one again afterwards.
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { getMonth } from "~/server/services/envelope/read.service";
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
}

/** The book, its movements and its closes; the ledger's clocks are the profile's. */
export async function seedParityBook(ctx: SeedContext): Promise<ParityBook> {
	const first = ctx.clocks[0] as Date;
	vi.useFakeTimers({ toFake: ["Date"] });
	try {
		vi.setSystemTime(new Date(first.getTime() - MONTHS_BACK * 30 * DAY));
		await forUser(ctx.userId).apply(setupEnvelopeBook, {
			...setupOf(ctx),
			currency: ctx.home,
			timeZone: resolveTimeZone(ctx.profile.timeZone),
		});
		vi.setSystemTime(first);
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
		// read's five seconds, so the values are kept first, in the device freeze's
		// own thirty.
		await runFreeze(adminDb, ctx.userId, { force: true });
		await getMonth(ctx.userId, undefined, first);
		return { bookId: book.id, envelopeIds };
	} finally {
		vi.useRealTimers();
	}
}
