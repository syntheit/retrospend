/**
 * Copies between rows re-seal under the new row (E2EE D11 PR 4.2, plan
 * section 4), with `sealing()` on, for an ARS user: a confirmed recurring
 * template's name becomes the expense's title sealed under the expense's id,
 * and an expense deleted and restored by its undo comes back under its old id
 * with fresh ciphertext. Each cell is read raw and opened here with the
 * owner's key and its own (table, column, row id).
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { type Keyring, openField } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb } from "~/server/db";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	sealedFile,
	storedValue,
	unsealAll,
	userKeyring,
} from "~/test/sealed-fixture";
import { seedArsRatesOn } from "../accounts/test-fixtures";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
} from "../entry/expense.mutation";
import { confirmRecurringExpense } from "../recurring-confirm.mutation";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

// Buenos Aires midnight is 03:00Z all year.
const DUE = new Date("2026-11-01T03:00:00.000Z");
let dropRates: () => Promise<unknown>;

sealedFile(master);
beforeAll(async () => {
	setSealingForTests(() => true);
	dropRates = await seedArsRatesOn([[DUE, "blue", "1468"]]);
});
afterAll(async () => {
	setSealingForTests();
	await dropRates();
	await unsealAll();
});
beforeEach(() => resetReloadsForTests());

async function arsUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: "ARS",
			timeZone: "America/Argentina/Buenos_Aires",
		},
	});
	return user.id;
}

/** The cell as stored, which must be sealed, and what it opens to under its own row. */
async function opened(
	userId: string,
	table: string,
	column: string,
	rowId: string,
) {
	const stored = (await storedValue(table, column, rowId)) as string;
	expect(stored.startsWith("\u0001k1:")).toBe(true);
	const ring = await userKeyring(userId, master.ring as Keyring);
	return { stored, text: openField(ring, stored, { table, column, rowId }) };
}

describe("copies between rows", () => {
	it("seals a confirmed template's name as the expense title under the expense's id", async () => {
		const me = await arsUser();
		const template = await createUserScopedDb(me).recurringTemplate.create({
			data: {
				userId: me,
				name: "Alquiler",
				amount: "1000",
				currency: "ARS",
				frequency: "MONTHLY",
				nextDueDate: DUE,
			},
		});
		const { value } = await forUser(me).apply(confirmRecurringExpense, {
			templateId: template.id,
		});
		const name = await opened(me, "recurring_template", "name", template.id);
		const title = await opened(me, "expense", "title", value.expenseId);
		expect(name.text).toBe("Alquiler");
		expect(title.text).toBe("Alquiler");
		expect(title.stored).not.toBe(name.stored);
		const expense = await createUserScopedDb(me).expense.findUniqueOrThrow({
			where: { id: value.expenseId },
		});
		expect(expense).toMatchObject({ title: "Alquiler", currency: "ARS" });
		expect(expense.amount.toString()).toBe("1000");
	});

	it("restores a deleted expense under its old id with fresh ciphertext", async () => {
		const me = await arsUser();
		const created = await createUserScopedDb(me).expense.create({
			data: {
				userId: me,
				title: "Asado",
				description: "Con amigos",
				amount: "45000",
				currency: "ARS",
				date: DUE,
				amountInUSD: "30.65",
				exchangeRate: "1468",
				pricingSource: "MANUAL",
			},
		});
		const before = await opened(me, "expense", "title", created.id);
		const gone = await forUser(me).apply(deleteExpenseEntry, {
			id: created.id,
		});
		expect(await fixtureDb.expense.count({ where: { id: created.id } })).toBe(
			0,
		);
		const back = await forUser(me).apply(restoreExpenseEntry, {
			token: gone.value.restore,
		});
		expect(back.value.id).toBe(created.id);
		const title = await opened(me, "expense", "title", created.id);
		const description = await opened(me, "expense", "description", created.id);
		expect(title.text).toBe("Asado");
		expect(description.text).toBe("Con amigos");
		expect(title.stored).not.toBe(before.stored);
	});
});
