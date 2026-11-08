/**
 * TITLE income rules on Postgres with titles that may be ciphertext. The
 * match is the app's `fold` (no case, no accents, contains), applied after
 * both the rule's text and the money in's title are opened with
 * readUserText. USD book: starting money 1,000.00, Rent, Dining, Spending.
 *
 * Rules, oldest first: "Save" gives 10% of a match to Rent when the title
 * contains the sealed text "cafe"; "Tip" gives 5% to Dining when it contains
 * the plain text "BONUS". Each money in is 1,000.00. Expected by hand:
 *
 *   A  sealed "CAFÉ bonus"   matches both:  Rent 100.00, Dining 50.00
 *   B  plain  "Cafe tip"     matches Save:  Rent 100.00
 *   C  plain  "Year BONUS"   matches Tip:   Dining 50.00
 *   D  sealed "Consulting"   matches none:  nothing
 *   E  plain  "Rent refund"  matches none:  nothing
 *
 * so Rent gets 200.00 and Dining 100.00. With no keyring the sealed rule text
 * is an error, never a silent non-match.
 *
 * "Also apply to this month's money in" matches the same way: a sealed rule
 * "cafe" at 10% reaches an earlier sealed "CAFÉ" income (Rent 100.00) and
 * leaves an earlier sealed "Consulting" alone.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import { applyRuleToMonth } from "./rule-crud.service";
import { runPendingRules } from "./rule.service";
import { setupEnvelopeBook } from "./setup.mutation";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 5) }]);

type Seeded = Awaited<ReturnType<typeof seedUser>>;

async function book(s: Seeded) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const b = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (name: string) =>
		b.envelopes.find((e) => e.name === name)?.id as string;
	return { bookId: b.id, id };
}

/** A TITLE rule created a minute ago, so the money in below is after it. */
async function titleRule(
	b: Awaited<ReturnType<typeof book>>,
	envelope: string,
	sortOrder: number,
	text: string,
	sealed: boolean,
	percent: number,
) {
	const id = randomUUID();
	await adminDb.incomeRule.create({
		data: {
			id,
			bookId: b.bookId,
			name: `Rule ${sortOrder}`,
			sortOrder,
			envelopeId: b.id(envelope),
			createdAt: new Date(Date.now() - 60_000),
			matchKind: "TITLE",
			matchTitle: sealed
				? sealField(keyring, text, {
						table: "income_rule",
						column: "matchTitle",
						rowId: id,
					})
				: text,
			action: "PERCENT",
			value: percent,
		},
	});
	return id;
}

/** A 1,000.00 income whose title is stored plain or sealed to its own row id. */
async function income(s: Seeded, title: string, sealed: boolean) {
	const row = await addRow(s.user.id, {
		amount: 1000,
		direction: "IN",
		inType: "INCOME",
	});
	await adminDb.expense.update({
		where: { id: row.id },
		data: {
			title: sealed
				? sealField(keyring, title, {
						table: "expense",
						column: "title",
						rowId: row.id,
					})
				: title,
		},
	});
	return row.id;
}

const run = (s: Seeded, withKeyring: boolean) =>
	userTransaction(adminDb, s.user.id, (tx) =>
		runPendingRules(
			tx,
			s.user.id,
			new Date(),
			withKeyring ? keyring : undefined,
		),
	);

describe("TITLE income rules over sealed and plain text", () => {
	let s: Seeded;
	let b: Awaited<ReturnType<typeof book>>;
	let ids: Record<"A" | "B" | "C" | "D" | "E", string>;

	beforeAll(async () => {
		s = await seedUser();
		b = await book(s);
		await titleRule(b, "Rent", 0, "cafe", true, 10);
		await titleRule(b, "Dining", 1, "BONUS", false, 5);
		ids = {
			A: await income(s, "CAFÉ bonus", true),
			B: await income(s, "Cafe tip", false),
			C: await income(s, "Year BONUS", false),
			D: await income(s, "Consulting", true),
			E: await income(s, "Rent refund", false),
		};
	});

	it("without a keyring, sealed text is an error and nothing is written", async () => {
		await expect(run(s, false)).rejects.toBeInstanceOf(FieldCryptoError);
		await expect(
			adminDb.budgetMovement.count({
				where: { bookId: b.bookId, kind: "RULE" },
			}),
		).resolves.toBe(0);
	});

	it("with a keyring, each money in runs the rules its title matches", async () => {
		await run(s, true);
		const rows = await adminDb.budgetMovement.findMany({
			where: { bookId: b.bookId, kind: "RULE" },
		});
		const by = (id: string) =>
			rows
				.filter((r) => r.sourceExpenseId === id)
				.map((r) => [r.toEnvelopeId, Number(r.amount)] as const)
				.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
		const rent = b.id("Rent");
		const dining = b.id("Dining");
		const sorted = (pairs: (readonly [string, number])[]) =>
			[...pairs].sort((x, y) => x[0].localeCompare(y[0]));
		expect(by(ids.A)).toEqual(
			sorted([
				[rent, 100],
				[dining, 50],
			]),
		);
		expect(by(ids.B)).toEqual([[rent, 100]]);
		expect(by(ids.C)).toEqual([[dining, 50]]);
		expect(by(ids.D)).toEqual([]);
		expect(by(ids.E)).toEqual([]);
		const total = (env: string) =>
			rows
				.filter((r) => r.toEnvelopeId === env)
				.reduce((sum, r) => sum + Number(r.amount), 0);
		expect(total(rent)).toBe(200);
		expect(total(dining)).toBe(100);
	});

	it("running again writes nothing more", async () => {
		const before = await adminDb.budgetMovement.count({
			where: { bookId: b.bookId, kind: "RULE" },
		});
		await run(s, true);
		await expect(
			adminDb.budgetMovement.count({
				where: { bookId: b.bookId, kind: "RULE" },
			}),
		).resolves.toBe(before);
	});
});

describe("also apply a sealed TITLE rule to this month's money in", () => {
	it("reaches the earlier income whose sealed title matches, and no other", async () => {
		const s = await seedUser();
		const b = await book(s);
		const matching = await income(s, "CAFÉ latte", true);
		const other = await income(s, "Consulting", true);
		// The rule is made after both rows, so only "also apply" can reach them.
		const ruleId = await titleRule(b, "Rent", 0, "cafe", true, 10);
		await adminDb.incomeRule.update({
			where: { id: ruleId },
			data: { createdAt: new Date(Date.now() + 1_000) },
		});
		const done = await userTransaction(adminDb, s.user.id, (tx) =>
			applyRuleToMonth(
				tx,
				s.user.id,
				{ ruleId, batchId: randomUUID() },
				new Date(Date.now() + 2_000),
				keyring,
			),
		);
		expect(done.runs.map((r) => r.expenseId)).toEqual([matching]);
		const rows = await adminDb.budgetMovement.findMany({
			where: { bookId: b.bookId, kind: "RULE" },
		});
		expect(rows.map((r) => [r.sourceExpenseId, Number(r.amount)])).toEqual([
			[matching, 100],
		]);
		expect(rows.some((r) => r.sourceExpenseId === other)).toBe(false);
	});
});
