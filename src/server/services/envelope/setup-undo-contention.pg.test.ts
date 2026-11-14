/**
 * Undoing a set-up while someone else holds the book: the user is told the
 * budget is being changed right now (BOOK_IN_USE) and nothing is deleted.
 * The lock wait is cut short with `lock_timeout` so the test does not hang.
 */
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb } from "~/test/pg-harness";
import {
	arsBlueUser,
	arsFlex,
	counts,
	startBudget,
} from "./__tests__/setup-undo-fixture";
import { lockBook } from "./movement-state";
import { undoSetup } from "./setup-undo.service";

describe("the undo meets a writer on the book", () => {
	it("a lock wait that times out answers BOOK_IN_USE and deletes nothing", async () => {
		const s = await arsBlueUser();
		const start = await startBudget(s.user.id, arsFlex(s));
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let held!: () => void;
		const holding = new Promise<void>((r) => {
			held = r;
		});
		// Transaction A holds the book's advisory lock, as a movement or close does.
		const writer = userTransaction(adminDb, s.user.id, async (tx) => {
			await lockBook(tx, start.bookId);
			held();
			await gate;
		});
		await holding;
		try {
			await expect(
				userTransaction(adminDb, s.user.id, async (tx) => {
					await tx.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
					await undoSetup(tx, s.user.id, { token: start.token });
				}),
			).rejects.toMatchObject({
				code: "BOOK_IN_USE",
				message: expect.stringContaining("being changed right now"),
			});
		} finally {
			release();
			await writer;
		}
		expect((await counts(start.bookId)).budget_book).toBe(1);
	});
});
