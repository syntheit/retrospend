/**
 * The stamp check of guardedExpense is a compare-and-swap: two writes that
 * both read stamp T cannot both pass. The first to lock the row wins; the
 * other waits on the row lock, reads what the winner left and is refused.
 * Each case holds the first transaction open (after its write, before commit)
 * until Postgres reports the second one is blocked on the row lock, so the
 * overlap is certain, not left to timing.
 */

import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	asMobile,
	call,
	createTestUser,
	expectBody,
	fixtureDb,
} from "~/server/api/v1/core/__tests__/harness";
import {
	type LedgerCaller,
	updateInput,
} from "~/server/services/api-v1/expenses";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { defaultTimeZone } from "~/server/services/user-time-zone";
import { adminDb } from "~/test/pg-harness";
import {
	deleteExpensesBulk,
	restoreExpensesBulk,
} from "./bulk-delete.mutation";
import { categorizeExpenses } from "./categorize.mutation";
import { deleteExpenseEntry, updateExpenseEntry } from "./expense.mutation";
import { guardedExpense } from "./guarded.mutation";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const STALE = "stale stamp";
const stale = () => new Error(STALE);
const today = () => dayKey(new Date(), defaultTimeZone());

/** Runs `mutation`, then keeps its transaction open until `release()`. */
function heldOpen<I, V>(mutation: MoneyMutation<I, V>) {
	let release!: () => void;
	let reached!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const written = new Promise<void>((resolve) => {
		reached = resolve;
	});
	const held: MoneyMutation<I, V> = {
		...mutation,
		run: async (tx, input, actor) => {
			const done = await mutation.run(tx, input, actor);
			reached();
			await gate;
			return done;
		},
	};
	return { held, release, written };
}

/** Resolves once a transaction of this database waits on a row lock. */
async function waitUntilBlocked() {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
			SELECT count(*)::int AS waiting FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'`;
		if ((row?.waiting ?? 0) > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("the second write never blocked on the row lock");
}

describe("guardedExpense is a compare-and-swap on the expense row", () => {
	let userId: string;
	let as: Record<string, string>;
	let food: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		food = (
			await fixtureDb.category.create({
				data: {
					userId,
					name: `Food ${randomUUID().slice(0, 6)}`,
					color: "teal",
				},
			})
		).id;
	});

	async function add(title: string) {
		const made = await expectBody<{
			expense: { id: string; updatedAt: string };
		}>(
			await call("/expenses", {
				method: "POST",
				headers: as,
				body: {
					title,
					amount: "10",
					currency: "USD",
					date: today(),
					categoryId: food,
				},
				idempotent: true,
			}),
			contract.expenses.create,
			201,
		);
		return made.expense;
	}

	const edit = (id: string, title: string) =>
		updateInput({ timeZone: "UTC" } as LedgerCaller, {
			id,
			title,
			amount: "20",
			currency: "USD",
			date: today(),
			categoryId: food,
		});

	const row = (id: string) =>
		fixtureDb.expense.findUniqueOrThrow({ where: { id } });

	it("two edits that both hold stamp T: one wins, the other is refused and the winner's row stays", async () => {
		const made = await add("Original");
		const first = heldOpen(updateExpenseEntry);

		const winner = forUser(userId).apply(
			guardedExpense(first.held, made.updatedAt, stale),
			edit(made.id, "First"),
		);
		await first.written;
		const loser = forUser(userId).apply(
			guardedExpense(updateExpenseEntry, made.updatedAt, stale),
			edit(made.id, "Second"),
		);
		const loserOutcome = loser.then(
			() => "wrote",
			(error: Error) => error.message,
		);
		await waitUntilBlocked();
		first.release();

		await expect(winner).resolves.toBeDefined();
		await expect(loserOutcome).resolves.toBe(STALE);
		expect((await row(made.id)).title).toBe("First");
	});

	it("a delete holding the old stamp is refused after an edit commits, and the row stays", async () => {
		const made = await add("Original");
		const first = heldOpen(updateExpenseEntry);

		const winner = forUser(userId).apply(
			guardedExpense(first.held, made.updatedAt, stale),
			edit(made.id, "Edited"),
		);
		await first.written;
		const loser = forUser(userId).apply(
			guardedExpense(deleteExpenseEntry, made.updatedAt, stale),
			{ id: made.id },
		);
		const loserOutcome = loser.then(
			() => "deleted",
			(error: Error) => error.message,
		);
		await waitUntilBlocked();
		first.release();

		await expect(winner).resolves.toBeDefined();
		await expect(loserOutcome).resolves.toBe(STALE);
		expect((await row(made.id)).title).toBe("Edited");
	});

	it("an edit holding the old stamp is refused after a delete commits as not found", async () => {
		const made = await add("Original");
		const first = heldOpen(deleteExpenseEntry);

		const winner = forUser(userId).apply(
			guardedExpense(first.held, made.updatedAt, stale),
			{ id: made.id },
		);
		await first.written;
		const loser = forUser(userId).apply(
			guardedExpense(updateExpenseEntry, made.updatedAt, stale),
			edit(made.id, "Late"),
		);
		const loserOutcome = loser.then(
			() => "wrote",
			(error: Error) => error.message,
		);
		await waitUntilBlocked();
		first.release();

		await expect(winner).resolves.toBeDefined();
		// The row is gone, so the stamp check passes through to the mutation's own 404.
		await expect(loserOutcome).resolves.toBe("Expense not found");
		await expect(
			fixtureDb.expense.count({ where: { id: made.id } }),
		).resolves.toBe(0);
	});

	it("a bulk categorize undo holding the old stamps is refused after an edit to one of its rows commits", async () => {
		const other = (
			await fixtureDb.category.create({
				data: {
					userId,
					name: `Other ${randomUUID().slice(0, 6)}`,
					color: "teal",
				},
			})
		).id;
		const a = await add("A");
		const b = await add("B");
		const { value } = await forUser(userId).apply(categorizeExpenses, {
			moves: [{ categoryId: other, ids: [a.id, b.id] }],
		});
		const undo = {
			moves: value.previous,
			lenient: true,
			expected: value.stamps,
		};
		const first = heldOpen(updateExpenseEntry);

		const winner = forUser(userId).apply(
			guardedExpense(first.held, value.stamps[b.id], stale),
			edit(b.id, "Edited"),
		);
		await first.written;
		const loser = forUser(userId).apply(categorizeExpenses, undo);
		const loserOutcome = loser.then(
			() => "undone",
			(error: Error) => error.message,
		);
		await waitUntilBlocked();
		first.release();

		await expect(winner).resolves.toBeDefined();
		await expect(loserOutcome).resolves.toBe(
			"This expense changed since. Undo is no longer safe.",
		);
		expect((await row(a.id)).categoryId).toBe(other);
		expect((await row(b.id)).title).toBe("Edited");
	});

	it("the redo of a bulk delete holding the old stamps is refused after an edit to one of its rows commits, and the edited row survives", async () => {
		const a = await add("A");
		const b = await add("B");
		const user = forUser(userId);
		const first = await user.apply(deleteExpensesBulk, { ids: [a.id, b.id] });
		const back = await user.apply(restoreExpensesBulk, {
			stash: first.value.stash,
		});
		const held = heldOpen(updateExpenseEntry);

		const winner = user.apply(
			guardedExpense(held.held, back.value.stamps[b.id], stale),
			edit(b.id, "Edited"),
		);
		await held.written;
		const loser = user.apply(deleteExpensesBulk, {
			ids: [a.id, b.id],
			expected: back.value.stamps,
		});
		const loserOutcome = loser.then(
			() => "deleted",
			(error: Error) => error.message,
		);
		await waitUntilBlocked();
		held.release();

		await expect(winner).resolves.toBeDefined();
		await expect(loserOutcome).resolves.toBe(
			"This expense changed since. Undo is no longer safe.",
		);
		expect((await row(b.id)).title).toBe("Edited");
		await expect(
			fixtureDb.expense.count({ where: { id: { in: [a.id, b.id] } } }),
		).resolves.toBe(2);
	});
});
