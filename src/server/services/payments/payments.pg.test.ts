/**
 * Payments end to end on real Postgres, through userTransaction and RLS:
 * payment.record previewed and applied (preview = record), viewer-relative
 * pending (I5), confirm, the payment figures, the header's RLS, and the M3
 * backfill run twice against legacy rows.
 *
 * Fixture (ARS home, as MONEY-MOVES Example A): Sofía owes Martín ARS 18,000
 * outside projects and BRL 412.50 in Florianópolis; Paz (not on Retrospend)
 * owes Sofía ARS 80,000. Rates: ARS 1,355 and BRL 5 per USD (Blue), so
 * BRL 1 = ARS 271.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { figures, readFiguresIn } from "~/server/figures/registry";
import { forUser, userTransactionRunner } from "~/server/services/preview";
import { createPreviewRunner } from "~/server/services/preview/runner";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { confirmPayment, unconfirmPayment } from "./confirm.mutation";
import { type RecordPaymentInput, recordPayment } from "./record.mutation";
import { personKey } from "./view";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = new Date(
	`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});

async function seedRates() {
	for (const [currency, rate] of [
		["ARS", "1355"],
		["BRL", "5"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency, type: "blue" } },
			create: { date: today, currency, type: "blue", rate },
			update: { rate },
		});
	}
}

/** `payer` paid `amount`; `debtor` owes all of it. */
async function seedShare(
	payer: ParticipantRef,
	debtor: ParticipantRef,
	amount: string,
	currency: string,
	opts: { projectId?: string; date?: string } = {},
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount,
			currency,
			date: new Date(opts.date ?? "2026-10-08"),
			paidByType: payer.participantType,
			paidById: payer.participantId,
			createdByType: payer.participantType,
			createdById: payer.participantId,
			projectId: opts.projectId ?? null,
			splitParticipants: {
				create: [
					{ ...debtor, shareAmount: amount, verificationStatus: "ACCEPTED" },
					{ ...payer, shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

const runnerFor = (u: TestUser) =>
	createPreviewRunner({
		figures,
		actor: { userId: u.user.id },
		transaction: userTransactionRunner(u.user.id),
	});

async function figureFor(u: TestUser, id: string, personId?: string) {
	return userTransaction(adminDb, u.user.id, (tx) =>
		readFiguresIn(tx, [figures.get(id)], {
			userId: u.user.id,
			...(personId ? { personId } : {}),
		}),
	).then((m) => m.get(id));
}

let sofia: TestUser;
let martin: TestUser;
let floripa: string;
let paz: ParticipantRef;

beforeAll(async () => {
	await seedRates();
	sofia = await createTestUser();
	martin = await createTestUser();
	for (const u of [sofia, martin]) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	}
	floripa = (
		await adminDb.project.create({
			data: {
				name: "Florianópolis",
				createdById: sofia.user.id,
				primaryCurrency: "BRL",
			},
		})
	).id;
	for (const u of [sofia, martin]) {
		await adminDb.projectParticipant.create({
			data: { projectId: floripa, ...ref(u), role: "EDITOR" },
		});
	}
	const shadow = await adminDb.shadowProfile.create({
		data: { createdById: sofia.user.id, name: "Paz" },
	});
	paz = { participantType: "shadow", participantId: shadow.id };
	await seedShare(ref(martin), ref(sofia), "18000", "ARS");
	await seedShare(ref(martin), ref(sofia), "412.5", "BRL", {
		projectId: floripa,
		date: "2026-10-09",
	});
	await seedShare(ref(sofia), paz, "80000", "ARS", { date: "2026-10-16" });
});

const payMartin = (amount: string | null): RecordPaymentInput => ({
	person: ref(martin),
	direction: "outgoing",
	currency: "ARS",
	amount,
	paymentMethod: "Mercado Pago",
});

describe("figure balance.person", () => {
	it("is the balance with one person per currency, from the viewer's side", async () => {
		expect(
			await figureFor(sofia, "balance.person", personKey(ref(martin))),
		).toEqual([
			{ minor: -1_800_000, currency: "ARS" },
			{ minor: -41_250, currency: "BRL" },
		]);
		expect(
			await figureFor(martin, "balance.person", personKey(ref(sofia))),
		).toEqual([
			{ minor: 1_800_000, currency: "ARS" },
			{ minor: 41_250, currency: "BRL" },
		]);
	});
});

describe("figure owed.owedToYou", () => {
	it("adds up the people who owe you, net at the reference rate", async () => {
		expect(await figureFor(sofia, "owed.owedToYou")).toEqual([
			{ minor: 8_000_000, currency: "ARS" },
		]);
	});
});

describe("figure owed.youOwe", () => {
	it("adds up the people you owe, never netted against Owed to you", async () => {
		// ARS 18,000 + BRL 412.50 x 271 = ARS 129,787.50.
		expect(await figureFor(sofia, "owed.youOwe")).toEqual([
			{ minor: 12_978_750, currency: "ARS" },
		]);
	});
});

describe("payment.record on Postgres", () => {
	it("previews exactly what it records, and the preview writes nothing", async () => {
		const runner = runnerFor(sofia);
		const before = await adminDb.payment.count();

		const previewed = await runner.preview(recordPayment, payMartin("129788"));
		expect(await adminDb.payment.count()).toBe(before);
		expect(previewed.value).toMatchObject({
			recorded: true,
			status: "PROPOSED",
		});
		expect(
			previewed.changes.map((c) => [c.id, c.currency, c.delta.minor]),
		).toEqual([
			["balance.person", "ARS", 1_800_000],
			["balance.person", "BRL", 41_250],
			["owed.youOwe", "ARS", -12_978_750],
		]);
		expect(previewed.unchanged.map((u) => u.id)).toEqual(["owed.owedToYou"]);

		const { undo, ...applied } = await runner.apply(
			recordPayment,
			payMartin("129788"),
		);
		const { paymentId: _a, ...appliedValue } = applied.value as {
			paymentId: string;
		};
		const { paymentId: _p, ...previewedValue } = previewed.value as {
			paymentId: string;
		};
		expect(appliedValue).toEqual(previewedValue);
		expect(applied.changes).toEqual(previewed.changes);
		expect(undo).toMatchObject({ kind: "revert", mutation: "payment.record" });

		const header = await adminDb.payment.findFirstOrThrow({
			where: { payerId: sofia.user.id },
			include: { settlements: { orderBy: { initiatedAt: "asc" } } },
		});
		expect(header).toMatchObject({
			currency: "ARS",
			status: "PROPOSED",
			recordedById: sofia.user.id,
		});
		expect(header.amount.toString()).toBe("129788");
		// I2: the cash rows add up to the payment exactly.
		const paid = header.settlements.map((s) =>
			Number(s.convertedAmount ?? s.amount),
		);
		expect(paid.reduce((a, b) => a + b, 0)).toBe(129_788);
	});

	it("I5 counts the pending payment for Sofía at once and for Martín only after he confirms", async () => {
		const sofiaView = await computeBalance(adminDb, ref(sofia), ref(martin));
		const martinView = await computeBalance(adminDb, ref(martin), ref(sofia));
		expect(sofiaView.byCurrency).toEqual({});
		expect(martinView.byCurrency).toEqual({ ARS: 18000, BRL: 412.5 });

		const header = await adminDb.payment.findFirstOrThrow({
			where: { payerId: sofia.user.id },
		});
		const confirmed = await forUser(martin.user.id).apply(confirmPayment, {
			paymentId: header.id,
			person: ref(sofia),
		});
		expect(
			confirmed.changes.map((c) => [c.id, c.currency, c.delta.minor]),
		).toEqual([
			["balance.person", "ARS", -1_800_000],
			["balance.person", "BRL", -41_250],
			["owed.owedToYou", "ARS", -12_978_750],
		]);
		expect(
			(await computeBalance(adminDb, ref(martin), ref(sofia))).byCurrency,
		).toEqual({});

		// Undo puts the payment back to waiting for Martín, rows and all.
		expect(confirmed.undo).toEqual({
			kind: "revert",
			mutation: "payment.unconfirm",
			rows: [{ table: "payment", id: header.id }],
		});
		await forUser(martin.user.id).apply(unconfirmPayment, {
			paymentId: header.id,
			person: ref(sofia),
		});
		expect(
			(await adminDb.payment.findUniqueOrThrow({ where: { id: header.id } }))
				.status,
		).toBe("PROPOSED");
		const rows = await adminDb.settlement.findMany({
			where: { paymentGroupId: header.id },
		});
		expect(
			rows.every(
				(r) =>
					r.status === "PROPOSED" && r.confirmedByPayer && !r.confirmedByPayee,
			),
		).toBe(true);
		expect(
			(await computeBalance(adminDb, ref(martin), ref(sofia))).byCurrency,
		).toEqual({ ARS: 18000, BRL: 412.5 });
		await forUser(martin.user.id).apply(confirmPayment, {
			paymentId: header.id,
			person: ref(sofia),
		});
	});

	it("records money received from someone not on Retrospend as final, and refuses an overpayment", async () => {
		const runner = runnerFor(sofia);
		const tooMuch = await runner.apply(recordPayment, {
			person: paz,
			direction: "incoming",
			currency: "ARS",
			amount: "90000",
		});
		expect(tooMuch.value).toMatchObject({ recorded: false, reason: "overpay" });
		expect(tooMuch.changes).toEqual([]);

		const received = await runner.apply(recordPayment, {
			person: paz,
			direction: "incoming",
			currency: "ARS",
			amount: "80000",
		});
		expect(received.value).toMatchObject({
			recorded: true,
			status: "FINALIZED",
		});
		expect(await figureFor(sofia, "owed.owedToYou")).toEqual([
			{ minor: 0, currency: "ARS" },
		]);
	});

	it("audits a confirm that changed the amount with the rows it wrote", async () => {
		const jo = await createTestUser();
		await seedShare(ref(sofia), ref(jo), "100", "ARS");
		const claim = await forUser(jo.user.id).apply(recordPayment, {
			person: ref(sofia),
			direction: "outgoing",
			currency: "ARS",
			amount: "100",
		});
		if (!claim.value.recorded) throw new Error("not recorded");
		await forUser(sofia.user.id).apply(confirmPayment, {
			paymentId: claim.value.paymentId,
			person: ref(jo),
			amount: "98",
		});
		const rows = await adminDb.settlement.findMany({
			where: { paymentGroupId: claim.value.paymentId },
		});
		expect(rows.map((r) => [r.amount.toString(), r.status])).toEqual([
			["98", "FINALIZED"],
		]);
		const audit = await adminDb.auditLogEntry.findFirstOrThrow({
			where: {
				action: "SETTLED",
				changes: { path: ["paymentGroupId"], equals: claim.value.paymentId },
			},
		});
		expect(audit.changes).toMatchObject({
			amount: 98,
			settlementIds: rows.map((r) => r.id),
		});
	});

	it("keeps payment headers to the people on them (RLS)", async () => {
		const stranger = await createTestUser();
		expect(await stranger.db.payment.count()).toBe(0);
		expect(await sofia.db.payment.count()).toBeGreaterThanOrEqual(2);
		expect(await martin.db.payment.count()).toBe(1);
	});
});

/**
 * The deploy pre-check for M3 (read only, runs before or after M3): what the
 * backfill will do, and what it cannot do cleanly. mixed_paid_currency_groups
 * must be 0. converted_without_currency rows are backfilled as paid in their
 * own currency (their convertedAmount cannot be labeled); sub_minor_amounts
 * are rows with more decimals than their currency keeps, which the engine
 * rounds half-even. Before M3 there is no payment table, so headers are
 * counted through query_to_xml, which only runs when the table exists.
 */
const M3_PRECHECK = `
WITH decimals(code, d) AS (VALUES
  ('BIF',0),('CLP',0),('DJF',0),('GNF',0),('ISK',0),('JPY',0),('KMF',0),('KRW',0),('PYG',0),
  ('RWF',0),('UGX',0),('UYI',0),('VND',0),('VUV',0),('XAF',0),('XOF',0),('XPF',0),
  ('BHD',3),('IQD',3),('JOD',3),('KWD',3),('LYD',3),('OMR',3),('TND',3),
  ('USDC',2),('USDT',2),('DAI',2),('BUSD',2),
  ('BTC',8),('ETH',8),('SOL',8),('BNB',8),('XRP',8),('DOGE',8),('ADA',8),('AVAX',8),('POL',8),
  ('LTC',8),('DOT',8),('LINK',8),('TON',8),('UNI',8),('NEAR',8),('SUI',8),('BCH',8)
),
srows AS (
  SELECT s.*,
    COALESCE(s."paymentGroupId", s.id) AS group_id,
    (s."convertedAmount" IS NOT NULL AND s."convertedCurrency" IS NOT NULL) AS converted,
    COALESCE(d.d, 2) AS amount_decimals,
    COALESCE(cd.d, 2) AS converted_decimals
  FROM settlement s
  LEFT JOIN decimals d ON d.code = s.currency
  LEFT JOIN decimals cd ON cd.code = s."convertedCurrency"
)
SELECT
  (SELECT COUNT(*) FROM srows WHERE "paymentGroupId" IS NULL) AS rows_without_group,
  (SELECT COUNT(DISTINCT group_id) FROM srows)
    - CASE WHEN to_regclass('public.payment') IS NULL THEN 0 ELSE
        (xpath('/row/n/text()', query_to_xml(
          'SELECT COUNT(*) AS n FROM payment p WHERE EXISTS (SELECT 1 FROM settlement s WHERE COALESCE(s."paymentGroupId", s.id) = p.id)',
          false, true, '')))[1]::text::bigint
      END AS headers_to_create,
  (SELECT COUNT(*) FROM (
    SELECT group_id FROM srows WHERE NOT "isOffset" GROUP BY group_id
    HAVING COUNT(DISTINCT CASE WHEN converted THEN "convertedCurrency" ELSE currency END) > 1) g
  ) AS mixed_paid_currency_groups,
  (SELECT COUNT(*) FROM srows WHERE "convertedAmount" IS NOT NULL AND "convertedCurrency" IS NULL)
    AS converted_without_currency,
  (SELECT COUNT(*) FROM srows
    WHERE amount <> round(amount, amount_decimals)
      OR (converted AND "convertedAmount" <> round("convertedAmount", converted_decimals)))
    AS sub_minor_amounts
`;

/** One legacy settlement row, as the old settle-up wrote it. */
interface LegacyRow {
	id: string;
	from: string;
	to: string;
	amount: string;
	currency: string;
	convertedAmount?: string;
	convertedCurrency?: string;
	status: "FINALIZED" | "PROPOSED";
	payeeAgreed: boolean;
	group: string | null;
	offset?: boolean;
	reason?: string;
}

const INSERT_LEGACY = `INSERT INTO settlement (id, "fromParticipantType", "fromParticipantId", "toParticipantType", "toParticipantId",
	amount, currency, "convertedAmount", "convertedCurrency", status, "confirmedByPayer", "confirmedByPayee",
	"initiatedAt", "paymentGroupId", "isOffset", "autoConfirmedReason")
	VALUES ($1, 'user', $2, 'user', $3, $4, $5, $6, $7, $8, true, $9, '2026-09-01 12:00:00', $10, $11, $12)`;

describe("M3 payments_corrections backfill", () => {
	it("gives every legacy row a group and a header, and running it twice changes nothing", async () => {
		const migration = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261023200000_payments_corrections/migration.sql",
			),
			"utf8",
		);
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		const count = async () => {
			const row = (await client.query(M3_PRECHECK)).rows[0];
			return Object.fromEntries(
				Object.entries(row).map(([k, v]) => [k, Number(v)]),
			);
		};
		try {
			// The pre-check also runs before M3, when there is no payment table.
			await client.query("BEGIN");
			await client.query("ALTER TABLE payment RENAME TO payment_hidden");
			const groups = await client.query(
				'SELECT COUNT(DISTINCT COALESCE("paymentGroupId", id)) AS n FROM settlement',
			);
			expect((await count()).headers_to_create).toBe(Number(groups.rows[0].n));
			await client.query("ROLLBACK");

			const baseline = await count();
			await client.query(
				'ALTER TABLE settlement DROP CONSTRAINT "settlement_paymentGroupId_fkey"',
			);
			const a = (await createTestUser()).user.id;
			const b = martin.user.id;
			const legacy: LegacyRow[] = [
				{
					id: "legacy-single",
					from: a,
					to: b,
					amount: "10",
					currency: "USD",
					status: "FINALIZED",
					payeeAgreed: true,
					group: null,
				},
				// convertedAmount without a currency: paid in its own currency, 10.005 is sub-minor.
				{
					id: "legacy-conv",
					from: a,
					to: b,
					amount: "10.005",
					currency: "USD",
					convertedAmount: "12",
					status: "FINALIZED",
					payeeAgreed: true,
					group: null,
				},
				{
					id: "legacy-g1",
					from: a,
					to: b,
					amount: "5",
					currency: "EUR",
					convertedAmount: "6",
					convertedCurrency: "USD",
					status: "PROPOSED",
					payeeAgreed: false,
					group: "group-1",
				},
				{
					id: "legacy-g2",
					from: a,
					to: b,
					amount: "4",
					currency: "USD",
					status: "PROPOSED",
					payeeAgreed: false,
					group: "group-1",
				},
				{
					id: "legacy-off",
					from: b,
					to: a,
					amount: "3",
					currency: "USD",
					status: "PROPOSED",
					payeeAgreed: false,
					group: "group-1",
					offset: true,
				},
				{
					id: "legacy-recv",
					from: b,
					to: a,
					amount: "7",
					currency: "USD",
					status: "FINALIZED",
					payeeAgreed: true,
					group: "group-2",
					reason: "Recorded by the payee as a payment received",
				},
			];
			for (const r of legacy) {
				await client.query(INSERT_LEGACY, [
					r.id,
					r.from,
					r.to,
					r.amount,
					r.currency,
					r.convertedAmount ?? null,
					r.convertedCurrency ?? null,
					r.status,
					r.payeeAgreed,
					r.group,
					r.offset ?? false,
					r.reason ?? null,
				]);
			}

			const plus = (key: string, n: number) => (baseline[key] ?? 0) + n;
			expect(await count()).toEqual({
				rows_without_group: plus("rows_without_group", 2),
				headers_to_create: plus("headers_to_create", 4),
				mixed_paid_currency_groups: 0,
				converted_without_currency: plus("converted_without_currency", 1),
				sub_minor_amounts: plus("sub_minor_amounts", 1),
			});

			await client.query(migration);
			await client.query(migration);

			expect(await count()).toEqual({
				rows_without_group: 0,
				headers_to_create: 0,
				mixed_paid_currency_groups: 0,
				converted_without_currency: plus("converted_without_currency", 1),
				sub_minor_amounts: plus("sub_minor_amounts", 1),
			});
			const headers = await adminDb.payment.findMany({
				where: {
					id: { in: ["legacy-single", "legacy-conv", "group-1", "group-2"] },
				},
				orderBy: { id: "asc" },
			});
			expect(
				headers.map((h) => [
					h.id,
					h.payerId,
					h.amount.toString(),
					h.currency,
					h.status,
					h.recordedById,
				]),
			).toEqual([
				["group-1", a, "10", "USD", "PROPOSED", a],
				["group-2", b, "7", "USD", "FINALIZED", a],
				["legacy-conv", a, "10.005", "USD", "FINALIZED", a],
				["legacy-single", a, "10", "USD", "FINALIZED", a],
			]);
		} finally {
			await client.end();
		}
	});
});
