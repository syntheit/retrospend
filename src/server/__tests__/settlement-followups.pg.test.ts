/**
 * The follow-ups of the settlement write RLS review, on Postgres through the
 * scoped client (role retrospend_app, app.current_user_id = the caller):
 *
 * 1. An offset row's rate is held to the stored rate of its currency pair.
 * 2. A SETTLED audit entry is only written in the transaction that finalized
 *    the rows, and only with the rows and header the claim really had; the
 *    rows an undo puts back match that entry.
 * 3. The marker that tells a rewrite from a plain delete is in a table the app
 *    role cannot reach, not a setting the app can write.
 *
 * Money is derived by hand. The payment currency is USD, so a rate is USD per
 * 1 unit of the row's currency: fiat is stored per USD (PLN 4 per USD is 0.25
 * USD per PLN), and the band is 0.2x to 5x of the reference.
 *
 * Rates are seeded in currencies no other test file uses (PLN, CZK, HUF), on
 * dates of their own, because the test database is shared by the whole run.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previousOf } from "~/server/services/payments/confirm-restore";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { Prisma } from "~prisma";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser; // pays, records
let ben: TestUser; // receives

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// The rates are taken away again: the database is shared by the whole run.
afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({
		where: { currency: { in: ["PLN", "CZK", "HUF"] } },
	});
});

beforeAll(async () => {
	ana = await createTestUser();
	ben = await createTestUser();
	const rates: [string, string, string, string][] = [
		// date, currency, type, per USD
		["2026-05-01", "PLN", "official", "4"],
		["2026-07-01", "PLN", "official", "8"],
		["2026-04-01", "CZK", "official", "25"],
		["2026-04-01", "CZK", "blue", "20"],
		["2026-09-01", "HUF", "official", "400"],
	];
	await adminDb.exchangeRate.createMany({
		data: rates.map(([date, currency, type, rate]) => ({
			date: day(date),
			currency,
			type,
			rate,
		})),
		skipDuplicates: true,
	});
});

async function went(run: () => Promise<unknown>): Promise<boolean> {
	try {
		await run();
		return true;
	} catch {
		return false;
	}
}

const inTx = <T>(
	who: TestUser,
	run: (tx: Prisma.TransactionClient) => Promise<T>,
) => who.db.$transaction(run);

const header = (
	status: "PROPOSED" | "FINALIZED",
	over: Partial<Prisma.PaymentUncheckedCreateInput> = {},
): Prisma.PaymentUncheckedCreateInput => ({
	id: randomUUID(),
	payerType: "user",
	payerId: ana.user.id,
	payeeType: "user",
	payeeId: ben.user.id,
	amount: "40",
	currency: "USD",
	paidOn: day("2026-06-01"),
	recordedByType: "user",
	recordedById: ana.user.id,
	status,
	...over,
});

const claim = { status: "PROPOSED" as const, confirmedByPayer: true };

const row = (
	paymentGroupId: string,
	from: TestUser,
	to: TestUser,
	extra: Partial<Prisma.SettlementUncheckedCreateInput> = {},
): Prisma.SettlementUncheckedCreateInput => ({
	paymentGroupId,
	fromParticipantType: "user",
	fromParticipantId: from.user.id,
	toParticipantType: "user",
	toParticipantId: to.user.id,
	amount: "40",
	currency: "USD",
	status: "PROPOSED",
	...extra,
});

describe("offset rate band", () => {
	/**
	 * Ana pays USD 40 and offsets Ben's debt of PLN 100 (at `rate` USD per PLN)
	 * against her own debt of USD `mine`. `mine` is PLN 100 x rate, so the two
	 * sides always balance and only the rate is in question.
	 */
	const offsetting = (o: {
		currency?: string;
		rate: string | null;
		mine: string;
		paidOn?: string;
		rateType?: string | null;
		head?: Partial<Prisma.PaymentUncheckedCreateInput>;
	}) => {
		const head = header("PROPOSED", {
			paidOn: day(o.paidOn ?? "2026-06-01"),
			...o.head,
		});
		return went(() =>
			inTx(ana, async (tx) => {
				await tx.payment.create({ data: head });
				const id = head.id as string;
				await tx.settlement.create({ data: row(id, ana, ben, claim) });
				await tx.settlement.create({
					data: row(id, ben, ana, {
						...claim,
						isOffset: true,
						confirmedByPayer: false,
						confirmedByPayee: true,
						amount: "100",
						currency: o.currency ?? "PLN",
						exchangeRateUsed: o.rate,
						rateType: o.rateType === undefined ? "official" : o.rateType,
					}),
				});
				await tx.settlement.create({
					data: row(id, ana, ben, {
						...claim,
						isOffset: true,
						amount: o.mine,
					}),
				});
			}),
		);
	};

	it("holds a rate to 0.2x to 5x of the stored one", async () => {
		// PLN 4 per USD on 2026-05-01 (the latest on or before the 1st of June):
		// 0.25 USD per PLN, so the band is 0.05 to 1.25.
		expect(await offsetting({ rate: "0.25", mine: "25" })).toBe(true);
		expect(await offsetting({ rate: "0.05", mine: "5" })).toBe(true);
		expect(await offsetting({ rate: "1.25", mine: "125" })).toBe(true);
		expect(await offsetting({ rate: "0.049999", mine: "4.9999" })).toBe(false);
		expect(await offsetting({ rate: "1.250001", mine: "125.0001" })).toBe(
			false,
		);
	});

	it("refuses a rate of 0.000001, which would cancel PLN 100 for USD 0.0001", async () => {
		expect(await offsetting({ rate: "0.000001", mine: "0.0001" })).toBe(false);
	});

	it("uses the latest rate on or before the payment date, else the next one", async () => {
		// PLN 8 per USD from 2026-07-01: 0.125 USD per PLN, band 0.025 to 0.625.
		// 1 June reads the 4 of May (band 0.05 to 1.25), 1 August the 8 of July.
		expect(await offsetting({ rate: "1.2", mine: "120" })).toBe(true);
		expect(
			await offsetting({ rate: "1.2", mine: "120", paidOn: "2026-08-01" }),
		).toBe(false);
		expect(
			await offsetting({ rate: "0.6", mine: "60", paidOn: "2026-08-01" }),
		).toBe(true);
		// HUF has one rate, 400 per USD on 2026-09-01, after the payment: 0.0025
		// USD per HUF, band 0.0005 to 0.0125.
		const huf = (rate: string, mine: string) =>
			offsetting({ currency: "HUF", rate, mine });
		expect(await huf("0.0125", "1.25")).toBe(true);
		expect(await huf("0.0126", "1.26")).toBe(false);
	});

	it("reads the widest spread of the rate types of the day", async () => {
		// CZK official 25 and blue 20 per USD: 0.04 and 0.05 USD per CZK, so the
		// band runs from 0.2 x 0.04 = 0.008 to 5 x 0.05 = 0.25.
		const czk = (rate: string, mine: string) =>
			offsetting({ currency: "CZK", rate, mine });
		expect(await czk("0.008", "0.8")).toBe(true);
		expect(await czk("0.25", "25")).toBe(true);
		expect(await czk("0.00799", "0.799")).toBe(false);
		expect(await czk("0.2501", "25.01")).toBe(false);
	});

	it("never treats a missing reference rate as 1", async () => {
		// RON has no stored rate at all. A rate of 1 would pass any band.
		expect(await offsetting({ currency: "RON", rate: "1", mine: "100" })).toBe(
			false,
		);
		expect(
			await offsetting({ currency: "RON", rate: "0.22", mine: "22" }),
		).toBe(false);
	});

	it("takes a typed rate only when the payment carries it", async () => {
		// The payer typed RON 0.22 USD per RON; the payment says so. The rate has no
		// stored one to be held to, so it stands only as the payment's own rate.
		const typed = {
			rateType: "custom",
			rate: "0.22",
			rateCurrency: "RON",
		};
		expect(
			await offsetting({
				currency: "RON",
				rate: "0.22",
				mine: "22",
				rateType: "custom",
				head: typed,
			}),
		).toBe(true);
		expect(
			await offsetting({
				currency: "RON",
				rate: "0.23",
				mine: "23",
				rateType: "custom",
				head: typed,
			}),
		).toBe(false);
		// Another currency than the typed one has no excuse.
		expect(
			await offsetting({
				currency: "RON",
				rate: "0.22",
				mine: "22",
				rateType: "custom",
				head: { ...typed, rateCurrency: "SEK" },
			}),
		).toBe(false);
	});

	it("makes an offset in the typed currency equal the typed rate", async () => {
		// PLN is rated (band 0.05 to 1.25). The payer typed 0.3; a row labeled custom
		// must say 0.3 and not 0.31, though both are in the band.
		const typed = { rateType: "custom", rate: "0.3", rateCurrency: "PLN" };
		expect(
			await offsetting({
				rate: "0.3",
				mine: "30",
				rateType: "custom",
				head: typed,
			}),
		).toBe(true);
		expect(
			await offsetting({
				rate: "0.31",
				mine: "31",
				rateType: "custom",
				head: typed,
			}),
		).toBe(false);
	});

	it("holds a typed rate on the payment itself to the band", async () => {
		const typed = (rate: string) => ({
			rateType: "custom",
			rate,
			rateCurrency: "PLN",
		});
		const withHeader = (rate: string) =>
			went(() =>
				inTx(ana, async (tx) => {
					const head = header("PROPOSED", typed(rate));
					await tx.payment.create({ data: head });
					await tx.settlement.create({
						data: row(head.id as string, ana, ben, {
							...claim,
							amount: "100",
							currency: "PLN",
							convertedAmount: "40",
							convertedCurrency: "USD",
							exchangeRateUsed: "0.4",
							rateType: "custom",
						}),
					});
				}),
			);
		expect(await withHeader("1.25")).toBe(true);
		expect(await withHeader("1.26")).toBe(false);
		expect(await withHeader("0.04")).toBe(false);
	});

	it("leaves cash rows alone: a small pair rounds its rate to 0", async () => {
		// Paying a KRW debt in ETH has a rate near 2e-7, which the row stores as 0.
		const id = randomUUID();
		const ok = await went(() =>
			inTx(ana, async (tx) => {
				await tx.payment.create({ data: header("PROPOSED", { id }) });
				await tx.settlement.create({
					data: row(id, ana, ben, {
						...claim,
						amount: "100",
						currency: "PLN",
						convertedAmount: "40",
						convertedCurrency: "USD",
						exchangeRateUsed: "0.000001",
					}),
				});
			}),
		);
		expect(ok).toBe(true);
	});

	it("does not look at the rows of an old payment again when it is confirmed", async () => {
		// A payment written before the band existed, at a rate outside it, balanced.
		const head = header("PROPOSED");
		const id = head.id as string;
		await adminDb.payment.create({ data: head });
		await adminDb.settlement.create({ data: row(id, ana, ben, claim) });
		await adminDb.settlement.create({
			data: row(id, ben, ana, {
				...claim,
				isOffset: true,
				confirmedByPayer: false,
				confirmedByPayee: true,
				amount: "100",
				currency: "PLN",
				exchangeRateUsed: "0.01",
				rateType: "official",
			}),
		});
		await adminDb.settlement.create({
			data: row(id, ana, ben, {
				...claim,
				isOffset: true,
				amount: "1",
			}),
		});
		const confirmed = await went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.updateMany({
					where: { paymentGroupId: id },
					data: {
						status: "FINALIZED",
						confirmedByPayer: true,
						confirmedByPayee: true,
						settledAt: new Date(),
					},
				});
				await tx.payment.update({
					where: { id },
					data: { status: "FINALIZED" },
				});
			}),
		);
		expect(confirmed).toBe(true);
	});
});

/** A pending claim of USD 10 and the rows and header it has before anyone touches it. */
async function pendingClaim() {
	const head = header("PROPOSED", { amount: "10" });
	const id = head.id as string;
	await adminDb.payment.create({ data: head });
	await adminDb.settlement.create({
		data: row(id, ana, ben, { ...claim, amount: "10" }),
	});
	const [before, rows] = await Promise.all([
		adminDb.payment.findUniqueOrThrow({ where: { id } }),
		adminDb.settlement.findMany({ where: { paymentGroupId: id } }),
	]);
	return { id, before, rows };
}

type Claim = Awaited<ReturnType<typeof pendingClaim>>;

/** The receiver's confirm, as confirm.mutation.ts writes it. */
async function finalize(
	tx: Prisma.TransactionClient,
	id: string,
	header: Prisma.PaymentUncheckedUpdateInput = {},
) {
	await tx.settlement.updateMany({
		where: { paymentGroupId: id, status: "PROPOSED" },
		data: {
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
			settledAt: new Date(),
		},
	});
	await tx.payment.update({
		where: { id },
		data: { status: "FINALIZED", ...header },
	});
}

const settled = (
	p: Claim,
	previous: unknown,
	over: { targetId?: string; paymentGroupId?: string | null } = {},
) => ({
	actorType: "user" as const,
	actorId: ben.user.id,
	action: "SETTLED" as const,
	targetType: "SETTLEMENT" as const,
	targetId: over.targetId ?? (p.rows[0]?.id as string),
	changes: {
		amount: 10,
		currency: "USD",
		...(over.paymentGroupId === null
			? {}
			: { paymentGroupId: over.paymentGroupId ?? p.id }),
		previous,
	} as Prisma.InputJsonValue,
});

const honest = (p: Claim) => previousOf(p.before, p.rows, "[]");

describe("the SETTLED entry", () => {
	it("is written by the receiver in the transaction that finalizes the rows", async () => {
		const p = await pendingClaim();
		await inTx(ben, async (tx) => {
			await finalize(tx, p.id);
			await tx.auditLogEntry.create({ data: settled(p, honest(p)) });
		});
		expect(
			await adminDb.auditLogEntry.count({
				where: { targetId: p.rows[0]?.id, action: "SETTLED" },
			}),
		).toBe(1);
	});

	it("is refused for rows that were finalized in an earlier transaction", async () => {
		const p = await pendingClaim();
		await inTx(ben, (tx) => finalize(tx, p.id));
		expect(
			await went(() =>
				ben.db.auditLogEntry.create({ data: settled(p, honest(p)) }),
			),
		).toBe(false);
	});

	it("is refused when the rows are only final in another payment's transaction", async () => {
		const mine = await pendingClaim();
		const theirs = await pendingClaim();
		expect(
			await went(() =>
				inTx(ben, async (tx) => {
					await finalize(tx, theirs.id);
					await tx.auditLogEntry.create({
						data: settled(mine, honest(mine)),
					});
				}),
			),
		).toBe(false);
	});

	it("is refused before the rows are final, even in the same transaction", async () => {
		const p = await pendingClaim();
		expect(
			await went(() =>
				inTx(ben, async (tx) => {
					await tx.auditLogEntry.create({ data: settled(p, honest(p)) });
					await finalize(tx, p.id);
				}),
			),
		).toBe(false);
	});

	it("is refused with a snapshot whose rows are not the claim's", async () => {
		/** The honest snapshot with its rows changed by `change`. */
		const forged =
			(
				change: (rows: Record<string, unknown>[]) => Record<string, unknown>[],
			) =>
			(p: Claim) => ({
				...honest(p),
				rows: change(JSON.parse(JSON.stringify(honest(p).rows))),
			});
		const first = (rows: Record<string, unknown>[]) => rows[0] ?? {};
		const attempts: [string, (p: Claim) => unknown][] = [
			["another amount", forged((rows) => [{ ...first(rows), amount: "1" }])],
			[
				"another person",
				forged((rows) => [{ ...first(rows), toParticipantId: "someone" }]),
			],
			[
				"another currency",
				forged((rows) => [{ ...first(rows), currency: "ARS" }]),
			],
			[
				"an extra row",
				forged((rows) => [
					...rows,
					{ ...first(rows), id: randomUUID(), amount: "5" },
				]),
			],
			["no rows", forged(() => [])],
			[
				"a row of another payment",
				forged((rows) => [{ ...first(rows), id: "other-row" }]),
			],
		];
		for (const [name, forge] of attempts) {
			const p = await pendingClaim();
			const ok = await went(() =>
				inTx(ben, async (tx) => {
					await finalize(tx, p.id);
					await tx.auditLogEntry.create({ data: settled(p, forge(p)) });
				}),
			);
			expect(ok, name).toBe(false);
			// The refused transaction left the claim as it was.
			expect(
				(await adminDb.payment.findUniqueOrThrow({ where: { id: p.id } }))
					.status,
			).toBe("PROPOSED");
		}
	});

	it("is refused with a header that is not the claim's", async () => {
		const attempts: [string, Record<string, unknown>][] = [
			["amount", { amount: "1" }],
			["date", { paidOn: "2026-01-01" }],
			["method", { paymentMethod: "Cash" }],
			["rate", { rate: "2", rateType: "custom", rateCurrency: "PLN" }],
		];
		for (const [name, over] of attempts) {
			const p = await pendingClaim();
			const ok = await went(() =>
				inTx(ben, async (tx) => {
					await finalize(tx, p.id);
					await tx.auditLogEntry.create({
						data: settled(p, { ...honest(p), ...over }),
					});
				}),
			);
			expect(ok, name).toBe(false);
		}
	});

	it("needs a snapshot and its payment's id", async () => {
		const noPrevious = await pendingClaim();
		expect(
			await went(() =>
				inTx(ben, async (tx) => {
					await finalize(tx, noPrevious.id);
					await tx.auditLogEntry.create({
						data: settled(noPrevious, undefined),
					});
				}),
			),
		).toBe(false);
		const wrongPayment = await pendingClaim();
		for (const paymentGroupId of [null, "another-payment"]) {
			expect(
				await went(() =>
					inTx(ben, async (tx) => {
						await finalize(tx, wrongPayment.id);
						await tx.auditLogEntry.create({
							data: settled(wrongPayment, honest(wrongPayment), {
								paymentGroupId,
							}),
						});
					}),
				),
			).toBe(false);
		}
	});
});

describe("putting a confirmed claim back (the undo)", () => {
	/** The receiver confirms, with the entry the app writes. */
	async function confirmed() {
		const p = await pendingClaim();
		await inTx(ben, async (tx) => {
			await finalize(tx, p.id);
			await tx.auditLogEntry.create({ data: settled(p, honest(p)) });
		});
		return p;
	}

	/** The undo as restoreClaim writes it: rows out, rows in, header back. */
	const undo = (
		p: Claim,
		rows: (
			original: Prisma.SettlementUncheckedCreateInput[],
		) => Prisma.SettlementUncheckedCreateInput[],
		headerBack: Prisma.PaymentUncheckedUpdateInput = {},
	) =>
		went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.deleteMany({ where: { paymentGroupId: p.id } });
				await tx.settlement.createMany({
					data: rows(
						p.rows.map((r) => ({
							...r,
							amount: r.amount.toString(),
						})),
					),
				});
				await tx.payment.update({
					where: { id: p.id },
					data: { status: "PROPOSED", ...headerBack },
				});
			}),
		);

	it("puts back the rows exactly as the claim had them", async () => {
		const p = await confirmed();
		expect(await undo(p, (rows) => rows)).toBe(true);
		const after = await adminDb.settlement.findMany({
			where: { paymentGroupId: p.id },
		});
		expect(after.map((r) => [r.status, r.amount.toString()])).toEqual([
			["PROPOSED", "10"],
		]);
	});

	it("refuses a header that is not the claim's", async () => {
		for (const back of [
			{ amount: "1000" },
			{ paidOn: day("2026-01-01") },
			{ paymentMethod: "Cash" },
			{ rate: "2", rateType: "custom", rateCurrency: "PLN" },
		]) {
			const p = await confirmed();
			expect(await undo(p, (rows) => rows, back)).toBe(false);
		}
	});

	it("puts the claim's own header back after a confirm changed it", async () => {
		// The receiver confirmed for USD 9 and the date of the 2nd; the claim was USD 10.
		const p = await pendingClaim();
		await inTx(ben, async (tx) => {
			await finalize(tx, p.id, { amount: "9", paidOn: day("2026-06-02") });
			await tx.auditLogEntry.create({ data: settled(p, honest(p)) });
		});
		expect(await undo(p, (rows) => rows)).toBe(false);
		expect(
			await undo(p, (rows) => rows, {
				amount: p.before.amount.toString(),
				paidOn: p.before.paidOn,
			}),
		).toBe(true);
	});

	it("refuses a row with another amount", async () => {
		const p = await confirmed();
		expect(
			await undo(p, (rows) => rows.map((r) => ({ ...r, amount: "1000" }))),
		).toBe(false);
	});

	it("refuses a row the claim did not have", async () => {
		const p = await confirmed();
		expect(
			await undo(p, (rows) => [
				...rows,
				{ ...(rows[0] as (typeof rows)[number]), id: randomUUID() },
			]),
		).toBe(false);
	});

	it("refuses a row with another currency, person or flag", async () => {
		const p = await confirmed();
		for (const over of [
			{ currency: "ARS" },
			{ toParticipantId: "someone-else" },
			{ confirmedByPayee: true },
		]) {
			expect(
				await undo(p, (rows) => rows.map((r) => ({ ...r, ...over }))),
			).toBe(false);
		}
	});

	it("refuses when no entry of the confirm exists to restore from", async () => {
		const p = await pendingClaim();
		// Final by the owner connection: no SETTLED entry was ever written.
		await adminDb.settlement.updateMany({
			where: { paymentGroupId: p.id },
			data: {
				status: "FINALIZED",
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date(),
			},
		});
		await adminDb.payment.update({
			where: { id: p.id },
			data: { status: "FINALIZED" },
		});
		expect(await undo(p, (rows) => rows)).toBe(false);
	});
});

describe("the marker of a rewrite", () => {
	/** Two confirmed cash rows, USD 6 and 4, between Ana and Ben. */
	async function twoRows() {
		const head = header("FINALIZED", { amount: "10" });
		const id = head.id as string;
		await adminDb.payment.create({ data: head });
		const final = {
			status: "FINALIZED" as const,
			confirmedByPayer: true,
			confirmedByPayee: true,
			settledAt: new Date(),
		};
		const six = await adminDb.settlement.create({
			data: row(id, ana, ben, { ...final, amount: "6" }),
		});
		await adminDb.settlement.create({
			data: row(id, ana, ben, { ...final, amount: "4" }),
		});
		return { id, six };
	}

	it("cannot be set by the app to drop one row of a payment", async () => {
		const p = await twoRows();
		const dropped = await went(() =>
			inTx(ben, async (tx) => {
				await tx.$queryRawUnsafe(
					"SELECT set_config('rs.ins_' || md5($1), '1', true)",
					p.id,
				);
				await tx.settlement.delete({ where: { id: p.six.id } });
			}),
		);
		expect(dropped).toBe(false);
		expect(
			await adminDb.settlement.count({ where: { paymentGroupId: p.id } }),
		).toBe(2);
	});

	it("still lets the receiver write the rows again in one transaction", async () => {
		// Confirming with a new amount: the claim's two rows out, one final row in.
		const head = header("PROPOSED", { amount: "10" });
		const id = head.id as string;
		await adminDb.payment.create({ data: head });
		for (const amount of ["6", "4"]) {
			await adminDb.settlement.create({
				data: row(id, ana, ben, { ...claim, amount }),
			});
		}
		const rewritten = await went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.deleteMany({ where: { paymentGroupId: id } });
				await tx.settlement.create({
					data: row(id, ana, ben, {
						status: "FINALIZED",
						confirmedByPayer: true,
						confirmedByPayee: true,
						settledAt: new Date(),
						amount: "9",
					}),
				});
				await tx.payment.update({
					where: { id },
					data: { status: "FINALIZED" },
				});
			}),
		);
		expect(rewritten).toBe(true);
	});

	it("is kept in a table the app role cannot read, write or call", async () => {
		// Raw statements are only scoped to the app role inside a transaction.
		const asApp = (sql: string) => inTx(ben, (tx) => tx.$queryRawUnsafe(sql));
		await expect(asApp("SELECT count(*) FROM payment_tx_note")).rejects.toThrow(
			/permission denied/,
		);
		await expect(
			asApp(
				`INSERT INTO payment_tx_note ("txid", "kind", "key") VALUES (txid_current(), 'ins', 'x')`,
			),
		).rejects.toThrow(/permission denied/);
		await expect(
			asApp("SELECT payment_tx_note_put('ins', 'x', NULL::jsonb)"),
		).rejects.toThrow(/permission denied/);
	});

	it("is cleared once its transaction has ended", async () => {
		const write = async () => {
			const head = header("PROPOSED", { amount: "10" });
			await inTx(ana, async (tx) => {
				await tx.payment.create({ data: head });
				await tx.settlement.create({
					data: row(head.id as string, ana, ben, { ...claim, amount: "10" }),
				});
			});
			return head.id as string;
		};
		const marks = async (key: string) =>
			(
				await adminDb.$queryRawUnsafe<{ n: number }[]>(
					`SELECT count(*)::int AS n FROM payment_tx_note WHERE "key" = $1`,
					key,
				)
			)[0]?.n;
		// The note of the first transaction is swept by the next write after it
		// ended; it could never be read again, its transaction id is spent.
		const first = await write();
		await write();
		expect(await marks(first)).toBe(0);
	});
});
