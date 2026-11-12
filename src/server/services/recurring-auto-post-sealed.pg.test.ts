/**
 * Recurring auto-post with sealing on (E2EE D11 PR 6.1, plan section 7 and
 * critic round 2 B and C), for a USD user in Buenos Aires with a USD 10
 * template due 2027-03-05 (03:00Z), swept at 12:00Z the same day:
 *
 *   cold user (no key), plaintext name "Gym" -> posts in the first pass; one
 *     data key, made before the apply's transaction and none inside it; the
 *     title is stored sealed and opens to "Gym"
 *   sealed name "Alquiler"                   -> the title is sealed under the
 *     expense's own id and opens to "Alquiler", never the template's ciphertext
 *   key_rotated during the apply             -> retry, template untouched; the
 *     next pass posts
 *   key lost (row deleted after a sealed write) -> failed, nothing posted or
 *     advanced, and no log line names the template
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { type Keyring, openField } from "~/server/crypto/field-crypto";
import { KEY_ROTATED, TextUnavailableError } from "~/server/crypto/field-open";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb } from "~/server/db";
import { keystoreDb } from "~/server/db-core";
import { evictDataKeyring } from "~/server/services/keys/data-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	sealedFile,
	storedValue,
	unsealAll,
	userKeyring,
} from "~/test/sealed-fixture";
import { sweepRecurringAutoPost } from "./recurring-auto-post";
import { confirmRecurringExpense } from "./recurring-confirm.mutation";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

const DUE = new Date("2027-03-05T03:00:00.000Z");
const NOW = new Date("2027-03-05T12:00:00.000Z");
const NONE = {
	posted: 0,
	raced: 0,
	missingRate: 0,
	retry: 0,
	capped: 0,
	failed: 0,
};

sealedFile(master);
beforeAll(() => setSealingForTests(() => true));
afterAll(async () => {
	setSealingForTests();
	await unsealAll();
});
beforeEach(() => {
	resetReloadsForTests();
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function user() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "USD", timeZone: "America/Argentina/Buenos_Aires" },
	});
	return user.id;
}

const templateData = (userId: string, name: string) => ({
	userId,
	name,
	amount: "10",
	currency: "USD",
	frequency: "MONTHLY" as const,
	nextDueDate: DUE,
});

/** A template stored before sealing, so writing it makes no key. */
async function plainTemplate(userId: string, name: string) {
	setSealingForTests(() => false);
	try {
		const row = await adminDb.recurringTemplate.create({
			data: templateData(userId, name),
		});
		return row.id;
	} finally {
		setSealingForTests(() => true);
	}
}

/** A template written by its owner: the name is sealed and the key made. */
async function sealedTemplate(userId: string, name: string) {
	const row = await createUserScopedDb(userId).recurringTemplate.create({
		data: templateData(userId, name),
	});
	return row.id;
}

const sweep = (userId: string) =>
	sweepRecurringAutoPost(NOW, {
		$queryRaw: (async (...args: Parameters<typeof adminDb.$queryRaw>) =>
			((await adminDb.$queryRaw(...args)) as { userId: string }[]).filter(
				(r) => r.userId === userId,
			)) as typeof adminDb.$queryRaw,
	});

const userKeys = async (userId: string) => {
	const [row] = await adminDb.$queryRaw<{ n: bigint }[]>`
		SELECT count(*) AS "n" FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
	return row?.n;
};

const expensesOf = (userId: string) =>
	adminDb.expense.findMany({ where: { userId }, select: { id: true } });

const dueOf = async (id: string) =>
	(
		await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
			select: { nextDueDate: true },
		})
	).nextDueDate.toISOString();

/** The title as stored, which must be sealed, and what it opens to under its own row. */
async function title(userId: string, expenseId: string) {
	const stored = (await storedValue("expense", "title", expenseId)) as string;
	expect(stored.startsWith("\u0001k1:")).toBe(true);
	const ring = await userKeyring(userId, master.ring as Keyring);
	return openField(ring, stored, {
		table: "expense",
		column: "title",
		rowId: expenseId,
	});
}

describe("a cold user", () => {
	it("posts in the first pass with one key, made before the transaction", async () => {
		const me = await user();
		await plainTemplate(me, "Gym");
		expect(await userKeys(me)).toBe(0n);
		const events: string[] = [];
		const keystore = keystoreDb.$transaction;
		vi.spyOn(keystoreDb, "$transaction").mockImplementation(((
			...args: unknown[]
		) => {
			events.push("keystore");
			return (keystore as (...a: unknown[]) => Promise<unknown>)(...args);
		}) as typeof keystore);
		const run = confirmRecurringExpense.run;
		vi.spyOn(confirmRecurringExpense, "run").mockImplementation(
			async (...args) => {
				events.push("apply begins");
				const done = await run(...args);
				events.push("apply ends");
				return done;
			},
		);
		expect(await sweep(me)).toEqual({ ...NONE, posted: 1 });
		expect(await userKeys(me)).toBe(1n);
		expect(events.at(0)).toBe("keystore");
		expect(events.slice(events.indexOf("apply begins"))).toEqual([
			"apply begins",
			"apply ends",
		]);
		const [expense] = await expensesOf(me);
		expect(await title(me, expense?.id as string)).toBe("Gym");
	});
});

describe("a sealed template name", () => {
	it("is sealed again under the expense's id", async () => {
		const me = await user();
		const id = await sealedTemplate(me, "Alquiler");
		expect(await sweep(me)).toEqual({ ...NONE, posted: 1 });
		const [expense] = await expensesOf(me);
		const expenseId = expense?.id as string;
		expect(await title(me, expenseId)).toBe("Alquiler");
		expect(await storedValue("expense", "title", expenseId)).not.toBe(
			await storedValue("recurring_template", "name", id),
		);
		const read = await createUserScopedDb(me).expense.findUniqueOrThrow({
			where: { id: expenseId },
		});
		expect(read.title).toBe("Alquiler");
	});
});

describe("a key that is not there", () => {
	it("retries a key replaced during the apply on the next pass", async () => {
		const me = await user();
		const id = await sealedTemplate(me, "Gym");
		vi.spyOn(confirmRecurringExpense, "run").mockRejectedValueOnce(
			new TextUnavailableError(KEY_ROTATED),
		);
		expect(await sweep(me)).toEqual({ ...NONE, retry: 1 });
		expect(await expensesOf(me)).toEqual([]);
		expect(await dueOf(id)).toBe(DUE.toISOString());
		expect(await sweep(me)).toEqual({ ...NONE, posted: 1 });
		expect(await dueOf(id)).toBe("2027-04-05T03:00:00.000Z");
	});

	it("fails closed on a lost key, naming nothing in the logs", async () => {
		const me = await user();
		const id = await sealedTemplate(me, "Gym");
		// A restore without the keystore: the key row is gone, the marker stays.
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${me}`;
		evictDataKeyring(me);
		const logged: unknown[] = [];
		for (const level of ["log", "warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				logged.push(...args);
			});
		expect(await sweep(me)).toEqual({ ...NONE, failed: 1 });
		expect(await expensesOf(me)).toEqual([]);
		expect(await dueOf(id)).toBe(DUE.toISOString());
		expect(await userKeys(me)).toBe(0n);
		expect(logged.length).toBeGreaterThan(0);
		expect(JSON.stringify(logged.map(String))).not.toContain("Gym");
	});
});
