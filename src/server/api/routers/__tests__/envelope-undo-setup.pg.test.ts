/**
 * envelope.undoSetup over tRPC on real Postgres: the token the setup answers
 * previews and undoes the start, the preview leaves the budget, a budget that
 * holds work of its own answers CONFLICT (BOOK_IN_USE), a spent token answers
 * CONFLICT too (ALREADY_UNDONE), and a token that is not ours answers
 * BAD_REQUEST. USD, Flex with Rent 500.00 and Dining 200.00 from 1,000.00:
 * 70,000 planned, 30,000 left to plan.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { envelopeRouter } from "../envelope";

type Seeded = Awaited<ReturnType<typeof seedUser>>;

const as = (s: Seeded) =>
	createCallerFactory(envelopeRouter)({
		session: makeSession({ id: s.user.id, name: s.user.name }),
		db: s.db,
		headers: new Headers(),
	});

const flex = (s: Seeded) => ({ ...setupInput(s), style: "FLEX" as const });

const books = (s: Seeded) =>
	adminDb.budgetBook.count({ where: { createdById: s.user.id } });

describe("envelope.undoSetup over tRPC", () => {
	it("previews, then takes the start back, and the month reads as no budget", async () => {
		const s = await seedUser();
		const started = await as(s).setup(flex(s));
		expect((await as(s).getMonth({}))?.toAssign.amount.minor).toBe(30_000);
		const { restore } = started.value;

		const preview = await as(s).undoSetupPreview({ token: restore });
		expect(preview.value.bookId).toBe(started.value.bookId);
		expect(await books(s)).toBe(1);

		const undone = await as(s).undoSetup({ token: restore });
		expect(undone.value).toEqual(preview.value);
		expect(undone.undo.kind).toBe("revert");
		expect(await books(s)).toBe(0);
		expect(await as(s).getMonth({})).toBeNull();
	});

	it("a budget with work of its own answers CONFLICT and stays", async () => {
		const s = await seedUser();
		const started = await as(s).setup(flex(s));
		const month = (await as(s).getMonth({}))?.month.key as number;
		const envelope = await adminDb.envelope.findFirstOrThrow({
			where: { bookId: started.value.bookId },
		});
		await as(s).assign({
			batchId: randomUUID(),
			month,
			mode: "add",
			items: [{ id: randomUUID(), envelopeId: envelope.id, amountMinor: 100 }],
		});
		await expect(
			as(s).undoSetup({ token: started.value.restore }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			as(s).undoSetupPreview({ token: started.value.restore }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await books(s)).toBe(1);
	});

	it("a spent token answers CONFLICT, a forged one BAD_REQUEST", async () => {
		const s = await seedUser();
		const { value } = await as(s).setup(flex(s));
		await as(s).undoSetup({ token: value.restore });
		await expect(
			as(s).undoSetup({ token: value.restore }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			as(s).undoSetup({
				token: { data: value.restore.data, sig: "a".repeat(64) },
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("another user's token answers BAD_REQUEST and their budget stays", async () => {
		const mine = await seedUser();
		const theirs = await seedUser();
		const { value } = await as(theirs).setup(flex(theirs));
		await expect(
			as(mine).undoSetup({ token: value.restore }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await books(theirs)).toBe(1);
	});
});
