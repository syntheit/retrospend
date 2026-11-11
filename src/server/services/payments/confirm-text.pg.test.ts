/**
 * Payment text through confirm, reject, remove and undo (E2EE D11 PR 4.1,
 * docs/roadmap/e2ee-d11-pr4.md section 4). Nothing seals in 4.1, so the
 * sealed cases seal the stored cells themselves (sealed-fixture) and check
 * that the money paths keep them byte for byte.
 *
 * Fixture, both ARS home: Sofía owes Martín ARS 18,000 in Trip and records
 * a payment of ARS 18,000, method "Mercado Pago", note "Octubre". From
 * Martín's side (a waiting payment does not count for its receiver):
 *
 *   before he confirms                   -> Sofía owes him ARS 18,000
 *   confirmed                            -> nothing owed
 *   confirmed as ARS 12,000 instead      -> ARS 18,000 - 12,000 = ARS 6,000 owed
 *   undone                               -> ARS 18,000 again
 *
 * Text, hand-derived:
 *   confirm over sealed cells            -> previous holds the stored ciphertext; every cell byte-identical
 *   v1 activity of that confirm          -> previous opened ("Mercado Pago", "Octubre"), no U+0001
 *   undo                                 -> header and rows back with the very same bytes
 *   confirm with a new method            -> only payment and row methods change
 *   confirm, sealing off; sealing on; undo -> the plaintext claim comes back, guards accept
 *   reject with a reason                 -> note and method cells byte-identical
 *   remove a pending payment             -> another payment's cells byte-identical
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { asMobile, call } from "~/server/api/v1/core/__tests__/harness";
import { forUser } from "~/server/services/preview";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { adminDb } from "~/test/pg-harness";
import { sealedFile, sealText } from "~/test/sealed-fixture";
import { confirmPayment, unconfirmPayment } from "./confirm.mutation";
import { recordPayment } from "./record.mutation";
import { rejectPayment, removeRecordedPayment } from "./reverse.mutation";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

sealedFile(master);
beforeAll(seedRates);
afterEach(() => setSealingForTests());

type Pair = { sofia: TestUser; martin: TestUser; trip: string };

async function pair(): Promise<Pair> {
	const [sofia, martin] = [await arsUser(), await arsUser()];
	const trip = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
	await seedShare(ref(martin), ref(sofia), "18000", "ARS", { projectId: trip });
	return { sofia, martin, trip };
}

async function record(p: Pair, amount = "18000"): Promise<string> {
	const { value } = await forUser(p.sofia.user.id).apply(recordPayment, {
		person: ref(p.martin),
		direction: "outgoing",
		currency: "ARS",
		amount,
		paymentMethod: "Mercado Pago",
		note: "Octubre",
	});
	return (value as { paymentId: string }).paymentId;
}

/** Every text cell of a payment, read raw. */
async function cells(paymentId: string) {
	const [header] = await adminDb.$queryRaw<Record<string, string | null>[]>`
		SELECT "note", "paymentMethod" FROM "payment" WHERE "id" = ${paymentId}`;
	const rows = await adminDb.$queryRaw<Record<string, string | null>[]>`
		SELECT "id", "note", "paymentMethod", "rejectedReason" FROM "settlement"
		WHERE "paymentGroupId" = ${paymentId} ORDER BY "id"`;
	return { header, rows };
}

/** Seals every text cell the payment holds with the instance key. */
async function sealPayment(paymentId: string) {
	const ring = master.ring as Keyring;
	const { header, rows } = await cells(paymentId);
	for (const [column, value] of Object.entries(header ?? {}))
		if (value) await sealText(ring, { table: "payment", column, rowId: paymentId }, value);
	for (const { id, ...text } of rows)
		for (const [column, value] of Object.entries(text))
			if (value)
				await sealText(
					ring,
					{ table: "settlement", column, rowId: id as string },
					value,
				);
	return cells(paymentId);
}

const martinView = async (p: Pair) =>
	(await computeBalance(adminDb, ref(p.martin), ref(p.sofia))).byCurrency;

const confirm = (p: Pair, paymentId: string, extra: object = {}) =>
	forUser(p.martin.user.id).apply(confirmPayment, {
		paymentId,
		person: ref(p.sofia),
		...extra,
	});

const undo = (p: Pair, paymentId: string) =>
	forUser(p.martin.user.id).apply(unconfirmPayment, {
		paymentId,
		person: ref(p.sofia),
	});

async function settledEntry(paymentId: string) {
	const entry = await adminDb.auditLogEntry.findFirstOrThrow({
		where: {
			action: "SETTLED",
			changes: { path: ["paymentGroupId"], equals: paymentId },
		},
	});
	return entry.changes as {
		previous: { paymentMethod: string; rows: Record<string, unknown>[] };
	};
}

describe("a confirm over sealed text", () => {
	it("keeps the stored ciphertext, serves it opened, and its undo puts back the same bytes", async () => {
		const p = await pair();
		const paymentId = await record(p);
		const sealed = await sealPayment(paymentId);
		expect(sealed.header?.paymentMethod).toMatch(/^\u0001k1:/);
		expect(await martinView(p)).toEqual({ ARS: 18000 });

		await confirm(p, paymentId);
		expect(await martinView(p)).toEqual({});
		// No method was given: nothing was rewritten.
		expect(await cells(paymentId)).toEqual(sealed);
		const { previous } = await settledEntry(paymentId);
		expect(previous.paymentMethod).toBe(sealed.header?.paymentMethod);
		for (const row of sealed.rows) {
			const kept = previous.rows.find((r) => r.id === row.id);
			expect(kept).toMatchObject({
				note: row.note,
				paymentMethod: row.paymentMethod,
			});
		}

		// The feed runs the tRPC auditLog procedure (its own response guard)
		// and serves the entry's changes, opened.
		const res = await call(`/projects/${p.trip}/activity`, {
			headers: await asMobile(p.martin.user.id),
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).not.toContain("\\u0001");
		const served = (
			JSON.parse(body) as {
				items: {
					action: { type: string };
					changes: { previous: typeof previous };
				}[];
			}
		).items.find((e) => e.action.type === "settled")?.changes;
		expect(served?.previous.paymentMethod).toBe("Mercado Pago");
		expect(served?.previous.rows.map((r) => r.note)).toEqual(
			sealed.rows.map(() => "Octubre"),
		);

		await undo(p, paymentId);
		expect(await martinView(p)).toEqual({ ARS: 18000 });
		expect(await cells(paymentId)).toEqual(sealed);
		const back = await p.martin.db.settlement.findMany({
			where: { paymentGroupId: paymentId },
		});
		expect(back.map((r) => [r.status, r.note, r.paymentMethod])).toEqual(
			sealed.rows.map(() => ["PROPOSED", "Octubre", "Mercado Pago"]),
		);
	});

	it("confirmed as a smaller amount, re-writes the rows and its undo restores the sealed ones", async () => {
		const p = await pair();
		const paymentId = await record(p);
		const sealed = await sealPayment(paymentId);

		const confirmed = await confirm(p, paymentId, { amount: "12000" });
		expect(confirmed.value).toMatchObject({
			allocation: { amount: { minor: 1_200_000, currency: "ARS" } },
		});
		expect(await martinView(p)).toEqual({ ARS: 6000 });
		// New rows (new ids) copy the opened text; nothing seals in 4.1.
		const rewritten = await cells(paymentId);
		expect(rewritten.rows.map((r) => r.id)).not.toEqual(
			sealed.rows.map((r) => r.id),
		);
		expect(rewritten.rows.every((r) => r.note === "Octubre")).toBe(true);
		expect(rewritten.header).toEqual(sealed.header);

		await undo(p, paymentId);
		expect(await martinView(p)).toEqual({ ARS: 18000 });
		expect(await cells(paymentId)).toEqual(sealed);
		const header = await adminDb.payment.findUniqueOrThrow({
			where: { id: paymentId },
		});
		expect([header.status, header.amount.toString()]).toEqual([
			"PROPOSED",
			"18000",
		]);
	});

	it("with a new method, changes only the methods", async () => {
		const p = await pair();
		const paymentId = await record(p);
		const sealed = await sealPayment(paymentId);

		await confirm(p, paymentId, { paymentMethod: "Transferencia" });
		const after = await cells(paymentId);
		expect(after.header).toEqual({
			note: sealed.header?.note,
			paymentMethod: "Transferencia",
		});
		expect(after.rows).toEqual(
			sealed.rows.map((r) => ({ ...r, paymentMethod: "Transferencia" })),
		);

		await undo(p, paymentId);
		expect(await cells(paymentId)).toEqual(sealed);
	});
});

describe("a confirm before sealing is switched on", () => {
	it("is undone after the switch: the plaintext claim comes back and the guards accept it", async () => {
		const p = await pair();
		const paymentId = await record(p);
		const plain = await cells(paymentId);
		expect(plain.header).toEqual({
			note: "Octubre",
			paymentMethod: "Mercado Pago",
		});

		await confirm(p, paymentId, { paymentMethod: "Transferencia" });
		expect(await martinView(p)).toEqual({});
		setSealingForTests(() => true);

		await undo(p, paymentId);
		expect(await martinView(p)).toEqual({ ARS: 18000 });
		expect(await cells(paymentId)).toEqual(plain);
		const back = await p.martin.db.payment.findUniqueOrThrow({
			where: { id: paymentId },
		});
		expect([back.status, back.paymentMethod, back.note]).toEqual([
			"PROPOSED",
			"Mercado Pago",
			"Octubre",
		]);
	});
});

describe("reject and remove", () => {
	it("leave every text cell they do not write byte-identical", async () => {
		const p = await pair();
		const rejected = await record(p, "9000");
		const sealedRejected = await sealPayment(rejected);

		await forUser(p.martin.user.id).apply(rejectPayment, {
			paymentId: rejected,
			person: ref(p.sofia),
			reason: "No llegó",
		});
		expect(await cells(rejected)).toEqual({
			header: sealedRejected.header,
			rows: sealedRejected.rows.map((r) => ({
				...r,
				rejectedReason: "No llegó",
			})),
		});

		const removed = await record(p, "9000");
		await sealPayment(removed);
		const before = await cells(rejected);
		await forUser(p.sofia.user.id).apply(removeRecordedPayment, {
			paymentId: removed,
			person: ref(p.martin),
		});
		expect((await cells(removed)).rows).toEqual([]);
		expect(await cells(rejected)).toEqual(before);
		// Rejected and removed: Sofía still owes the whole ARS 18,000.
		expect(await martinView(p)).toEqual({ ARS: 18000 });
	});
});
