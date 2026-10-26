/**
 * Attacks on payments at the database, through the scoped client (role
 * retrospend_app, app.current_user_id = the caller). Each test asserts what
 * must happen: a refused write leaves the payment as it was, and the writes the
 * app really makes still go through.
 *
 * Money in these tests is derived by hand. The payment currency is USD unless
 * a test says otherwise; the rate of an ARS row is USD per 1 ARS.
 *
 * A payment is checked as a whole at commit, so every write here is one
 * transaction, the way the app writes. The first block is the reviewer's probe
 * list (P1 to P11) from the settlement RLS review.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { Prisma } from "~prisma";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type Status = "PROPOSED" | "FINALIZED" | "REJECTED";

let ana: TestUser; // pays
let ben: TestUser; // receives
let cam: TestUser; // in another project only
let projectId: string; // ana and ben
let foreignProject: string; // cam only
let benEnvelope: string;
let anaEnvelope: string;
const seededRates: string[] = [];

/** Runs a write and reports whether it went through (an error or zero rows is a refusal). */
async function went(run: () => Promise<unknown>): Promise<boolean> {
	try {
		const result = await run();
		const count = (result as { count?: number } | null)?.count;
		return count === undefined || count > 0;
	} catch {
		return false;
	}
}

const inTx = <T>(
	who: TestUser,
	run: (tx: Prisma.TransactionClient) => Promise<T>,
) => who.db.$transaction(run);

const header = (
	recorder: TestUser,
	payer: TestUser,
	payee: TestUser,
	status: Status,
	over: Partial<Prisma.PaymentUncheckedCreateInput> = {},
): Prisma.PaymentUncheckedCreateInput => ({
	id: randomUUID(),
	payerType: "user",
	payerId: payer.user.id,
	payeeType: "user",
	payeeId: payee.user.id,
	amount: "10",
	currency: "USD",
	paidOn: new Date("2026-10-10"),
	recordedByType: "user",
	recordedById: recorder.user.id,
	status,
	...over,
});

/** A row between two people; USD 10 unless changed. Flags and status are the test's. */
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
	amount: "10",
	currency: "USD",
	status: "PROPOSED",
	...extra,
});

const claim = { status: "PROPOSED" as const, confirmedByPayer: true };
const mutual = () => ({
	status: "FINALIZED" as const,
	confirmedByPayer: true,
	confirmedByPayee: true,
	settledAt: new Date(),
});
const received = () => ({
	status: "FINALIZED" as const,
	confirmedByPayee: true,
	autoConfirmedReason: "Recorded by the payee as a payment received",
	settledAt: new Date(),
});

/** Writes a header and its rows as `who`, in one transaction. */
async function record(
	who: TestUser,
	head: Prisma.PaymentUncheckedCreateInput,
	rows: (id: string) => Prisma.SettlementUncheckedCreateInput[],
) {
	const id = head.id as string;
	await inTx(who, async (tx) => {
		await tx.payment.create({ data: head });
		for (const r of rows(id)) await tx.settlement.create({ data: r });
	});
	return id;
}

/** Seeds a legitimate payment with the owner connection: the thing under attack. */
async function seed(
	head: Prisma.PaymentUncheckedCreateInput,
	rows: (id: string) => Prisma.SettlementUncheckedCreateInput[],
) {
	const id = head.id as string;
	await adminDb.payment.create({ data: head });
	const made = [];
	for (const r of rows(id))
		made.push(await adminDb.settlement.create({ data: r }));
	return { id, rows: made };
}

const pendingPayment = () =>
	seed(header(ana, ana, ben, "PROPOSED"), (id) => [row(id, ana, ben, claim)]);
const mutualPayment = () =>
	seed(header(ana, ana, ben, "FINALIZED"), (id) => [
		row(id, ana, ben, mutual()),
	]);
const receivedPayment = () =>
	seed(header(ben, ana, ben, "FINALIZED"), (id) => [
		row(id, ana, ben, received()),
	]);

const statusesOf = async (id: string) =>
	(await adminDb.settlement.findMany({ where: { paymentGroupId: id } }))
		.map((r) => r.status)
		.sort();

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({ where: { id: { in: seededRates } } });
});

beforeAll(async () => {
	// The offsets below are in ARS, EUR, KRW and USD at rates close to these (per
	// USD, official, the payments' day); an offset's rate is held to 0.2x to 5x
	// of the stored one, and a missing rate is never 1. They are taken away
	// again in afterAll: the database is shared by the whole run, and other files
	// read the ARS rates of their own dates.
	for (const [currency, rate] of [
		["ARS", "1000"],
		["EUR", "0.92"],
		["KRW", "1350"],
	] as const) {
		const date = new Date("2026-10-10T00:00:00.000Z");
		const there = await adminDb.exchangeRate.findUnique({
			where: { date_currency_type: { date, currency, type: "official" } },
		});
		if (there) continue;
		const made = await adminDb.exchangeRate.create({
			data: { date, currency, type: "official", rate },
		});
		seededRates.push(made.id);
	}
	ana = await createTestUser();
	ben = await createTestUser();
	cam = await createTestUser();
	const p = await adminDb.project.create({
		data: { name: "Trip", createdById: ana.user.id },
	});
	projectId = p.id;
	for (const u of [ana, ben]) {
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "user",
				participantId: u.user.id,
				role: "EDITOR",
			},
		});
	}
	const f = await adminDb.project.create({
		data: { name: "Cam only", createdById: cam.user.id },
	});
	foreignProject = f.id;
	await adminDb.projectParticipant.create({
		data: {
			projectId: foreignProject,
			participantType: "user",
			participantId: cam.user.id,
			role: "ORGANIZER",
		},
	});
	for (const [owner, set] of [
		[ana, (id: string) => (anaEnvelope = id)],
		[ben, (id: string) => (benEnvelope = id)],
	] as const) {
		const book = await adminDb.budgetBook.create({
			data: {
				currency: "USD",
				createdById: owner.user.id,
				startDate: new Date("2026-01-01"),
				startMonth: 202601,
			},
		});
		const env = await adminDb.envelope.create({
			data: { bookId: book.id, name: "Fun", sortOrder: 0 },
		});
		set(env.id);
	}
});

describe("money the other way (offset rows)", () => {
	it("P1 the payee, recording a payment received, cannot write a lone final offset row payee -> payer", async () => {
		// Ben "received" USD 10 from Ana and also writes an offset ben -> ana with
		// nothing against it: Ana's debt would shrink by 10 for free.
		const ok = await went(() =>
			record(ben, header(ben, ana, ben, "FINALIZED"), (id) => [
				row(id, ben, ana, {
					...received(),
					isOffset: true,
					confirmedByPayer: true,
				}),
			]),
		);
		expect(ok).toBe(false);
		// With her cash row beside it, still one-sided.
		const withCash = await went(() =>
			record(ben, header(ben, ana, ben, "FINALIZED"), (id) => [
				row(id, ana, ben, received()),
				row(id, ben, ana, {
					...received(),
					isOffset: true,
					confirmedByPayer: true,
				}),
			]),
		);
		expect(withCash).toBe(false);
	});

	it("P1b the same as a FORGIVE row (Ana 'forgave' Ben) written by the payee", async () => {
		const ok = await went(() =>
			record(ben, header(ben, ana, ben, "FINALIZED"), (id) => [
				row(id, ben, ana, {
					isOffset: true,
					kind: "FORGIVE",
					...mutual(),
					autoConfirmedReason: "Forgiven by the payee",
				}),
			]),
		);
		expect(ok).toBe(false);
	});

	it("P2 the receiver cannot add a final offset row to a pending payment without replacing it", async () => {
		const p = await pendingPayment();
		const ok = await went(() =>
			ben.db.settlement.create({
				data: row(p.id, ben, ana, { ...mutual(), isOffset: true }),
			}),
		);
		expect(ok).toBe(false);
		expect(await statusesOf(p.id)).toEqual(["PROPOSED"]);
	});

	it("P2b ...nor reject the original and keep the forged final row", async () => {
		const p = await pendingPayment();
		const orig = p.rows[0];
		if (!orig) throw new Error("seed");
		// Step by step, as the probe did.
		await went(() =>
			ben.db.settlement.create({
				data: row(p.id, ben, ana, { ...mutual(), isOffset: true }),
			}),
		);
		await went(() =>
			ben.db.settlement.update({
				where: { id: orig.id },
				data: { status: "REJECTED", rejectedAt: new Date() },
			}),
		);
		await went(() =>
			ben.db.payment.update({
				where: { id: p.id },
				data: { status: "REJECTED" },
			}),
		);
		// And in one transaction, the way an app would try it.
		const together = await went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.create({
					data: row(p.id, ben, ana, { ...mutual(), isOffset: true }),
				});
				await tx.settlement.update({
					where: { id: orig.id },
					data: { status: "REJECTED", rejectedAt: new Date() },
				});
				await tx.payment.update({
					where: { id: p.id },
					data: { status: "REJECTED" },
				});
			}),
		);
		expect(together).toBe(false);
		expect(
			await adminDb.settlement.count({
				where: { paymentGroupId: p.id, status: "FINALIZED" },
			}),
		).toBe(0);
	});

	it("P3 the receiver cannot reopen a confirmed payment and inject a final offset", async () => {
		const p = await mutualPayment();
		// The header alone: a final row is still under it.
		expect(
			await went(() =>
				ben.db.payment.update({
					where: { id: p.id },
					data: { status: "PROPOSED" },
				}),
			),
		).toBe(false);
		// Header reopened and an offset injected in one transaction.
		const injected = await went(() =>
			inTx(ben, async (tx) => {
				await tx.payment.update({
					where: { id: p.id },
					data: { status: "PROPOSED" },
				});
				await tx.settlement.create({
					data: row(p.id, ben, ana, { ...mutual(), isOffset: true }),
				});
			}),
		);
		expect(injected).toBe(false);
		// Or just injected under the final header.
		expect(
			await went(() =>
				ben.db.settlement.create({
					data: row(p.id, ben, ana, { ...mutual(), isOffset: true }),
				}),
			),
		).toBe(false);
		expect(await statusesOf(p.id)).toEqual(["FINALIZED"]);
		expect(
			(await adminDb.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
		).toBe("FINALIZED");
	});
});

describe("offset rows balance", () => {
	// Ana pays Ben USD 40. Ben owed Ana ARS 30,000 in one project (rate 0.001
	// USD per ARS, so worth USD 30), and Ana owed Ben USD 30 elsewhere: the two
	// offsets cancel the same value.
	const settle = (
		over: {
			theirs?: Partial<Prisma.SettlementUncheckedCreateInput>;
			mine?: Partial<Prisma.SettlementUncheckedCreateInput>;
			head?: Partial<Prisma.PaymentUncheckedCreateInput>;
		} = {},
	) => {
		const head = header(ana, ana, ben, "PROPOSED", {
			amount: "40",
			...over.head,
		});
		return went(() =>
			record(ana, head, (id) => [
				row(id, ana, ben, { ...claim, amount: "40" }),
				row(id, ben, ana, {
					...claim,
					isOffset: true,
					confirmedByPayer: false,
					confirmedByPayee: true,
					amount: "30000",
					currency: "ARS",
					exchangeRateUsed: "0.001",
					projectId,
					...over.theirs,
				}),
				row(id, ana, ben, {
					...claim,
					isOffset: true,
					amount: "30",
					...over.mine,
				}),
			]),
		);
	};

	it("lets a payment's offsets cancel the same value on both sides", async () => {
		expect(await settle()).toBe(true);
	});

	it("allows the rounding the rows store, and refuses more", async () => {
		// Tolerance: dust USD 0.01 + 2 rows x 0.005 + rate precision 30,000 x 0.0000005 = 0.015, so 0.035.
		expect(await settle({ mine: { amount: "30.03" } })).toBe(true);
		expect(await settle({ mine: { amount: "30.04" } })).toBe(false);
		expect(await settle({ mine: { amount: "29.96" } })).toBe(false);
	});

	it("refuses offsets that cancel more on one side", async () => {
		expect(await settle({ mine: { amount: "100" } })).toBe(false);
		expect(await settle({ theirs: { amount: "1000000" } })).toBe(false);
	});

	it("refuses an offset in another currency without its rate, and a rate on the payment currency", async () => {
		expect(await settle({ theirs: { exchangeRateUsed: null } })).toBe(false);
		expect(await settle({ mine: { exchangeRateUsed: "2" } })).toBe(false);
	});

	it("refuses a negative row, which would run the money the other way", async () => {
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, { ...claim, amount: "-10" }),
				]),
			),
		).toBe(false);
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, {
						...claim,
						convertedAmount: "-10",
						convertedCurrency: "USD",
					}),
				]),
			),
		).toBe(false);
	});

	it("keeps ARS dust: offsets one peso apart are one payment's rounding", async () => {
		// P = ARS. Ben owed Ana USD 10 at 1,000 ARS per USD (ARS 10,000); Ana owed
		// Ben ARS 10,000.60. The payment currency's dust is ARS 1.
		const ok = await went(() =>
			record(
				ana,
				header(ana, ana, ben, "PROPOSED", { currency: "ARS", amount: "5000" }),
				(id) => [
					row(id, ana, ben, { ...claim, amount: "5000", currency: "ARS" }),
					row(id, ben, ana, {
						...claim,
						isOffset: true,
						confirmedByPayer: false,
						confirmedByPayee: true,
						amount: "10",
						currency: "USD",
						exchangeRateUsed: "1000",
						projectId,
					}),
					row(id, ana, ben, {
						...claim,
						isOffset: true,
						amount: "10000.60",
						currency: "ARS",
					}),
				],
			),
		);
		expect(ok).toBe(true);
	});
});

describe("traceless removal", () => {
	it("P4 the receiver cannot delete a mutual final payment outright (rows, then header)", async () => {
		const p = await mutualPayment();
		const rows = await went(() =>
			ben.db.settlement.deleteMany({ where: { paymentGroupId: p.id } }),
		);
		const head = await went(() =>
			ben.db.payment.delete({ where: { id: p.id } }),
		);
		const together = await went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.deleteMany({ where: { paymentGroupId: p.id } });
				await tx.payment.delete({ where: { id: p.id } });
			}),
		);
		expect(rows || head || together).toBe(false);
		expect(await statusesOf(p.id)).toEqual(["FINALIZED"]);
	});

	it("P5 the receiver cannot delete a pending claim instead of rejecting it", async () => {
		const p = await pendingPayment();
		const rows = await went(() =>
			ben.db.settlement.deleteMany({ where: { paymentGroupId: p.id } }),
		);
		const head = await went(() =>
			ben.db.payment.delete({ where: { id: p.id } }),
		);
		const together = await went(() =>
			inTx(ben, async (tx) => {
				await tx.settlement.deleteMany({ where: { paymentGroupId: p.id } });
				await tx.payment.delete({ where: { id: p.id } });
			}),
		);
		expect(rows || head || together).toBe(false);
		expect(await statusesOf(p.id)).toEqual(["PROPOSED"]);
	});

	it("lets the receiver reject a pending claim, and the recorder delete it", async () => {
		const p = await pendingPayment();
		const orig = p.rows[0];
		if (!orig) throw new Error("seed");
		await inTx(ben, async (tx) => {
			await tx.settlement.update({
				where: { id: orig.id },
				data: { status: "REJECTED", rejectedAt: new Date() },
			});
			await tx.payment.update({
				where: { id: p.id },
				data: { status: "REJECTED" },
			});
		});
		expect(await statusesOf(p.id)).toEqual(["REJECTED"]);
		await inTx(ana, async (tx) => {
			await tx.settlement.deleteMany({ where: { paymentGroupId: p.id } });
			await tx.payment.delete({ where: { id: p.id } });
		});
		expect(await adminDb.payment.count({ where: { id: p.id } })).toBe(0);
	});
});

describe("scope", () => {
	it("P6 the recorder cannot put a row in a project neither party is in", async () => {
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, { ...claim, projectId: foreignProject }),
				]),
			),
		).toBe(false);
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, { ...claim, projectId }),
				]),
			),
		).toBe(true);
	});
});

describe("a forgive", () => {
	const forgive = (
		id: string,
		over: Partial<Prisma.SettlementUncheckedCreateInput> = {},
	) =>
		row(id, ben, ana, {
			...mutual(),
			kind: "FORGIVE",
			autoConfirmedReason: "Forgiven by the payee",
			...over,
		});
	// Ben owes Ana; Ana, the payee, lets it go.
	const forgiveHead = (
		over: Partial<Prisma.PaymentUncheckedCreateInput> = {},
	) => header(ana, ben, ana, "FINALIZED", { amount: "0", ...over });

	it("P7 lets the payee forgive, with no envelope or her own", async () => {
		expect(
			await went(() => record(ana, forgiveHead(), (id) => [forgive(id)])),
		).toBe(true);
		expect(
			await went(() =>
				record(ana, forgiveHead(), (id) => [
					forgive(id, { forgiveEnvelopeId: anaEnvelope }),
				]),
			),
		).toBe(true);
	});

	it("refuses charging a forgive to somebody else's envelope", async () => {
		expect(
			await went(() =>
				record(ana, forgiveHead(), (id) => [
					forgive(id, { forgiveEnvelopeId: benEnvelope }),
				]),
			),
		).toBe(false);
	});

	it("refuses the payer writing a forgive of their own debt to a person who cannot answer", async () => {
		const shadow = await adminDb.shadowProfile.create({
			data: { name: "Gus", createdById: ana.user.id },
		});
		// Ana owes the shadow and "forgives" it herself: payer-recorded.
		expect(
			await went(() =>
				record(
					ana,
					header(ana, ana, ben, "FINALIZED", {
						amount: "0",
						payeeType: "shadow",
						payeeId: shadow.id,
					}),
					(id) => [
						row(id, ana, ben, {
							...mutual(),
							kind: "FORGIVE",
							toParticipantType: "shadow",
							toParticipantId: shadow.id,
							autoConfirmedReason: "Forgiven by the payee",
						}),
					],
				),
			),
		).toBe(false);
	});

	it("refuses a forgive that moves money, mixes with a payment, or is not final", async () => {
		expect(
			await went(() =>
				record(ana, forgiveHead({ amount: "10" }), (id) => [forgive(id)]),
			),
		).toBe(false);
		expect(
			await went(() =>
				record(ana, forgiveHead(), (id) => [
					forgive(id),
					row(id, ben, ana, {
						...mutual(),
						autoConfirmedReason: "Forgiven by the payee",
					}),
				]),
			),
		).toBe(false);
		expect(
			await went(() =>
				record(ana, forgiveHead({ status: "PROPOSED" }), (id) => [
					forgive(id, { status: "PROPOSED", confirmedByPayee: false }),
				]),
			),
		).toBe(false);
	});

	it("refuses an envelope on a payment row", async () => {
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, { ...claim, forgiveEnvelopeId: anaEnvelope }),
				]),
			),
		).toBe(false);
	});

	it("refuses the receiver of a payment rewriting it with a forgive row", async () => {
		const p = await pendingPayment();
		expect(
			await went(() =>
				inTx(ben, async (tx) => {
					await tx.settlement.deleteMany({ where: { paymentGroupId: p.id } });
					await tx.settlement.create({
						data: row(p.id, ana, ben, {
							...mutual(),
							kind: "FORGIVE",
							autoConfirmedReason: null,
						}),
					});
					await tx.payment.update({
						where: { id: p.id },
						data: { status: "FINALIZED", amount: "0" },
					});
				}),
			),
		).toBe(false);
	});
});

describe("who records what", () => {
	it("P8 the payee cannot record a payment as waiting for the payer", async () => {
		expect(
			await went(() =>
				record(ben, header(ben, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, { status: "PROPOSED", confirmedByPayee: true }),
				]),
			),
		).toBe(false);
		// Nor can the payer then confirm an inflated amount into it.
		const bare = header(ben, ana, ben, "PROPOSED");
		await adminDb.payment.create({ data: bare });
		expect(
			await went(() =>
				ana.db.settlement.create({
					data: row(bare.id as string, ana, ben, {
						...mutual(),
						amount: "99999",
					}),
				}),
			),
		).toBe(false);
	});

	it("refuses an inflated final row from the payer under a payment the payee recorded as final", async () => {
		const p = await receivedPayment();
		expect(
			await went(() =>
				ana.db.settlement.create({
					data: row(p.id, ana, ben, { ...mutual(), amount: "99999" }),
				}),
			),
		).toBe(false);
	});
});

describe("reminders", () => {
	it("lets the recorder remind one at a time, up to three, while pending", async () => {
		const p = await pendingPayment();
		const id = p.rows[0]?.id as string;
		for (const n of [1, 2, 3]) {
			await ana.db.settlement.update({
				where: { id },
				data: { reminderSentAt: new Date(), reminderCount: n },
			});
		}
		expect(
			await went(() =>
				ana.db.settlement.update({
					where: { id },
					data: { reminderSentAt: new Date(), reminderCount: 4 },
				}),
			),
		).toBe(false);
	});

	it("refuses the receiver reminding, and anyone resetting or jumping the count", async () => {
		const p = await pendingPayment();
		const id = p.rows[0]?.id as string;
		expect(
			await went(() =>
				ben.db.settlement.update({
					where: { id },
					data: { reminderSentAt: new Date(), reminderCount: 1 },
				}),
			),
		).toBe(false);
		await ana.db.settlement.update({
			where: { id },
			data: { reminderSentAt: new Date(), reminderCount: 1 },
		});
		for (const count of [0, 3]) {
			expect(
				await went(() =>
					ana.db.settlement.update({
						where: { id },
						data: { reminderCount: count },
					}),
				),
			).toBe(false);
		}
		expect(
			(await adminDb.settlement.findUniqueOrThrow({ where: { id } }))
				.reminderCount,
		).toBe(1);
	});

	it("refuses a reminder on a confirmed payment", async () => {
		const p = await mutualPayment();
		expect(
			await went(() =>
				ana.db.settlement.update({
					where: { id: p.rows[0]?.id as string },
					data: { reminderSentAt: new Date(), reminderCount: 1 },
				}),
			),
		).toBe(false);
	});
});

describe("audit", () => {
	const system = (over: Record<string, unknown> = {}) => ({
		actorType: "user" as const,
		actorId: "__system__",
		action: "DELETED" as const,
		targetType: "SETTLEMENT" as const,
		targetId: randomUUID(),
		projectId: foreignProject,
		...over,
	});

	it("P9 nobody can write a __system__ entry into a project feed", async () => {
		expect(
			await went(() => ana.db.auditLogEntry.create({ data: system() })),
		).toBe(false);
	});

	it("P9b ...nor with a raw INSERT, which reads nothing back", async () => {
		// Raw queries run as the app role only inside a transaction of the scoped client.
		expect(
			await went(() =>
				inTx(
					ana,
					(tx) =>
						tx.$executeRaw`INSERT INTO "audit_log_entry" ("id","actorType","actorId","action","targetType","targetId","projectId","timestamp") VALUES (${randomUUID()}, 'user', '__system__', 'DELETED', 'SETTLEMENT', ${randomUUID()}, ${foreignProject}, now())`,
				),
			),
		).toBe(false);
	});

	it("allows the system's AUTO_VERIFIED entry only for the writer's own auto-accepted split, in its project", async () => {
		const made = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "100",
				currency: "USD",
				date: new Date("2026-10-01"),
				paidByType: "user",
				paidById: ben.user.id,
				createdByType: "user",
				createdById: ben.user.id,
				projectId,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: ana.user.id,
							shareAmount: "50",
							verificationStatus: "AUTO_ACCEPTED",
						},
						{
							participantType: "user",
							participantId: ben.user.id,
							shareAmount: "50",
							verificationStatus: "PENDING",
						},
					],
				},
			},
			include: { splitParticipants: true },
		});
		const anas = made.splitParticipants.find(
			(s) => s.participantId === ana.user.id,
		);
		const bens = made.splitParticipants.find(
			(s) => s.participantId === ben.user.id,
		);
		const entry = (target: string, over: Record<string, unknown> = {}) => ({
			actorType: "user" as const,
			actorId: "__system__",
			action: "AUTO_VERIFIED" as const,
			targetType: "SPLIT_PARTICIPANT" as const,
			targetId: target,
			projectId,
			...over,
		});
		const write = (who: TestUser, data: ReturnType<typeof entry>) =>
			went(() => who.db.auditLogEntry.createMany({ data: [data] }));
		expect(await write(ana, entry(anas?.id as string))).toBe(true);
		// Another user's split, a split not accepted yet, another project, another action.
		expect(await write(cam, entry(anas?.id as string))).toBe(false);
		expect(await write(ben, entry(bens?.id as string))).toBe(false);
		expect(
			await write(
				ana,
				entry(anas?.id as string, { projectId: foreignProject }),
			),
		).toBe(false);
		expect(
			await write(ana, entry(anas?.id as string, { action: "DELETED" })),
		).toBe(false);
	});

	it("refuses a CREATED entry in the recorder's name for a row that already has one, and for a stranger's row", async () => {
		const p = await pendingPayment();
		const target = p.rows[0]?.id as string;
		const created = (actor: TestUser) => ({
			actorType: "user" as const,
			actorId: actor.user.id,
			action: "CREATED" as const,
			targetType: "SETTLEMENT" as const,
			targetId: target,
			changes: { amount: 10 },
		});
		// Ben rewrites the rows under Ana's name: once.
		expect(
			await went(() =>
				ben.db.auditLogEntry.createMany({ data: [created(ana)] }),
			),
		).toBe(true);
		expect(
			await went(() =>
				ben.db.auditLogEntry.createMany({ data: [created(ana)] }),
			),
		).toBe(false);
		// Cam is not a party; Ana's own entry in her own name is always fine.
		const other = await pendingPayment();
		expect(
			await went(() =>
				cam.db.auditLogEntry.createMany({
					data: [{ ...created(ana), targetId: other.rows[0]?.id as string }],
				}),
			),
		).toBe(false);
		expect(
			await went(() =>
				ana.db.auditLogEntry.createMany({
					data: [{ ...created(ana), targetId: other.rows[0]?.id as string }],
				}),
			),
		).toBe(true);
	});

	it("ties a CREATED entry in another person's name to whoever recorded the payment", async () => {
		const p = await receivedPayment(); // recorded by Ben
		expect(
			await went(() =>
				ana.db.auditLogEntry.createMany({
					data: [
						{
							actorType: "user",
							actorId: ben.user.id,
							action: "CREATED",
							targetType: "SETTLEMENT",
							targetId: p.rows[0]?.id as string,
						},
					],
				}),
			),
		).toBe(true); // Ben recorded it: Ana may log the rewrite under his name
		const q = await pendingPayment(); // recorded by Ana
		expect(
			await went(() =>
				ana.db.auditLogEntry.createMany({
					data: [
						{
							actorType: "user",
							actorId: ben.user.id,
							action: "CREATED",
							targetType: "SETTLEMENT",
							targetId: q.rows[0]?.id as string,
						},
					],
				}),
			),
		).toBe(false);
	});
});

describe("helpers answer only about your own payments", () => {
	it("hides who recorded a payment and whether it has rows from a stranger", async () => {
		const p = await mutualPayment();
		const ask = (who: TestUser) =>
			inTx(
				who,
				(tx) =>
					tx.$queryRaw<{ rows: boolean; final: boolean }[]>`
				SELECT payment_has_rows(${p.id}) AS rows, payment_has_final_rows(${p.id}) AS final`,
			);
		expect(await ask(ana)).toEqual([{ rows: true, final: true }]);
		expect(await ask(cam)).toEqual([{ rows: false, final: false }]);
		// Nobody can ask who recorded a payment.
		for (const fn of ["payment_recorder_key", "payment_recorded_by"]) {
			await expect(
				inTx(ana, (tx) =>
					tx.$queryRawUnsafe(`SELECT ${fn}('${p.id}', '${ana.user.id}')`),
				),
			).rejects.toThrow();
		}
	});
});

describe("legit writers", () => {
	it("P11 a user can void a payment a guest recorded as received (groupRoles.canVoid)", async () => {
		const guestId = randomUUID();
		const id = randomUUID();
		await adminDb.payment.create({
			data: {
				id,
				payerType: "user",
				payerId: ana.user.id,
				payeeType: "guest",
				payeeId: guestId,
				amount: "10",
				currency: "USD",
				paidOn: new Date("2026-10-10"),
				recordedByType: "guest",
				recordedById: guestId,
				status: "FINALIZED",
			},
		});
		await adminDb.settlement.create({
			data: {
				paymentGroupId: id,
				fromParticipantType: "user",
				fromParticipantId: ana.user.id,
				toParticipantType: "guest",
				toParticipantId: guestId,
				amount: "10",
				currency: "USD",
				status: "FINALIZED",
				confirmedByPayer: false,
				confirmedByPayee: true,
				autoConfirmedReason: "Recorded by the payee as a payment received",
				settledAt: new Date(),
			},
		});
		const { removeRecordedPayment } = await import(
			"~/server/services/payments/reverse.mutation"
		);
		await ana.db.$transaction((tx) =>
			removeRecordedPayment.run(
				tx as never,
				{
					paymentId: id,
					person: { participantType: "guest", participantId: guestId },
				},
				{ userId: ana.user.id } as never,
			),
		);
		expect(await adminDb.payment.count({ where: { id } })).toBe(0);
	});
});

describe("logAudit rethrow callers", () => {
	it("P10 the AUTO_VERIFIED sweep works through the scoped client, in one transaction", async () => {
		const { VerificationService } = await import(
			"~/server/services/shared-expenses/verification.service"
		);
		const old = new Date("2026-01-01");
		const made = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "100",
				currency: "USD",
				date: old,
				paidByType: "user",
				paidById: ben.user.id,
				createdByType: "user",
				createdById: ben.user.id,
				projectId,
				splitParticipants: {
					create: [
						{
							participantType: "user" as const,
							participantId: ana.user.id,
							shareAmount: "50",
							verificationStatus: "PENDING" as const,
							createdAt: old,
						},
					],
				},
			},
		});
		await adminDb.$executeRaw`UPDATE "shared_transaction" SET "updatedAt" = ${old} WHERE id = ${made.id}`;
		const svc = new VerificationService(ana.db as never, {
			participantType: "user",
			participantId: ana.user.id,
		});
		expect(await svc.findAndAutoAcceptExpired()).toBe(1);
		const sp = await adminDb.splitParticipant.findFirstOrThrow({
			where: { transactionId: made.id },
		});
		expect(sp.verificationStatus).toBe("AUTO_ACCEPTED");
		const entries = await adminDb.auditLogEntry.findMany({
			where: { action: "AUTO_VERIFIED", targetId: sp.id },
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ actorId: "__system__", projectId });
		// Nothing left to sweep.
		expect(await svc.findAndAutoAcceptExpired()).toBe(0);
	});
});

describe("a payment keeps balancing on every later event", () => {
	/** A pending USD 10 payment of Ana's with offsets of USD 5 each way. */
	const withOffsets = () =>
		seed(header(ana, ana, ben, "PROPOSED"), (id) => [
			row(id, ana, ben, claim),
			row(id, ben, ana, {
				status: "PROPOSED",
				confirmedByPayee: true,
				isOffset: true,
				amount: "5",
			}),
			row(id, ana, ben, { ...claim, isOffset: true, amount: "5" }),
		]);
	const confirmAll = (id: string, dropOffset: boolean) =>
		inTx(ben, async (tx) => {
			if (dropOffset) {
				await tx.settlement.deleteMany({
					where: {
						paymentGroupId: id,
						isOffset: true,
						fromParticipantId: ana.user.id,
					},
				});
			}
			await tx.settlement.updateMany({
				where: { paymentGroupId: id },
				data: {
					status: "FINALIZED",
					confirmedByPayer: true,
					confirmedByPayee: true,
					settledAt: new Date(),
				},
			});
			await tx.payment.update({ where: { id }, data: { status: "FINALIZED" } });
		});

	it("A1 the payee cannot void only the payer's side of balanced final offsets", async () => {
		const id = await record(ben, header(ben, ana, ben, "FINALIZED"), (id) => [
			row(id, ana, ben, received()),
			row(id, ben, ana, {
				...received(),
				isOffset: true,
				confirmedByPayer: true,
				amount: "5",
			}),
			row(id, ana, ben, { ...received(), isOffset: true, amount: "5" }),
		]);
		const payerSide = await adminDb.settlement.findFirstOrThrow({
			where: {
				paymentGroupId: id,
				isOffset: true,
				fromParticipantId: ana.user.id,
			},
		});
		expect(
			await went(() =>
				ben.db.settlement.delete({ where: { id: payerSide.id } }),
			),
		).toBe(false);
		expect(
			await adminDb.settlement.count({ where: { paymentGroupId: id } }),
		).toBe(3);
	});

	it("A2 the receiver cannot drop the pending payer-side offset and confirm the rest", async () => {
		const p = await withOffsets();
		expect(await went(() => confirmAll(p.id, true))).toBe(false);
		expect(await statusesOf(p.id)).toEqual([
			"PROPOSED",
			"PROPOSED",
			"PROPOSED",
		]);
		// Confirming all three rows is what the app does.
		const whole = await withOffsets();
		expect(await went(() => confirmAll(whole.id, false))).toBe(true);
		expect(await statusesOf(whole.id)).toEqual([
			"FINALIZED",
			"FINALIZED",
			"FINALIZED",
		]);
	});

	it("A4 the receiver cannot delete one of two confirmed cash rows and leave the payment final", async () => {
		const p = await seed(header(ana, ana, ben, "FINALIZED"), (id) => [
			row(id, ana, ben, { ...mutual(), amount: "6" }),
			row(id, ana, ben, { ...mutual(), amount: "4" }),
		]);
		const four = p.rows[1];
		expect(
			await went(() =>
				ben.db.settlement.delete({ where: { id: four?.id as string } }),
			),
		).toBe(false);
		expect(
			await adminDb.settlement.count({ where: { paymentGroupId: p.id } }),
		).toBe(2);
	});

	it("A3 refuses an offset with a zero rate, which would be worth nothing", async () => {
		expect(
			await went(() =>
				record(ana, header(ana, ana, ben, "PROPOSED"), (id) => [
					row(id, ana, ben, claim),
					row(id, ben, ana, {
						status: "PROPOSED",
						confirmedByPayee: true,
						isOffset: true,
						amount: "1000000",
						currency: "EUR",
						exchangeRateUsed: "0",
					}),
				]),
			),
		).toBe(false);
	});
});

describe("rounding of a cash row in another currency", () => {
	/**
	 * Ana pays in the payment currency P: cash in USD at `usd` P per USD, and
	 * offsets Ben's EUR 5 (at `eur` P per EUR) against `mine` USD.
	 */
	const cross = (o: {
		currency: string;
		paid: string;
		cashUsd: string;
		usd: string;
		eur: string;
		mine: string;
	}) =>
		went(() =>
			record(
				ana,
				header(ana, ana, ben, "PROPOSED", {
					currency: o.currency,
					amount: o.paid,
				}),
				(id) => [
					row(id, ana, ben, {
						...claim,
						amount: o.cashUsd,
						convertedAmount: o.paid,
						convertedCurrency: o.currency,
						exchangeRateUsed: o.usd,
						projectId,
					}),
					row(id, ben, ana, {
						status: "PROPOSED",
						confirmedByPayee: true,
						isOffset: true,
						amount: "5",
						currency: "EUR",
						exchangeRateUsed: o.eur,
						projectId,
					}),
					row(id, ana, ben, {
						...claim,
						isOffset: true,
						amount: o.mine,
						exchangeRateUsed: o.usd,
						projectId,
					}),
				],
			),
		);

	it("lets an ARS payment's leftover offset be one USD cent x the rate off", async () => {
		// Cash USD 4.58 x 1200 = ARS 5,496. EUR 5 x 1300 = 6,500 against USD 5.42 x 1200 = 6,504:
		// 4 apart. Tolerance: dust 1 + 2 x 0.005 + cash row (0.005 + 0.01 x 1200) = 13.02.
		const base = {
			currency: "ARS",
			paid: "5496",
			cashUsd: "4.58",
			usd: "1200",
			eur: "1300",
		};
		expect(await cross({ ...base, mine: "5.42" })).toBe(true);
		// USD 6 x 1200 = 7,200: 700 apart.
		expect(await cross({ ...base, mine: "6" })).toBe(false);
	});

	it("does the same for a KRW payment", async () => {
		// Cash USD 3.33 x 1350 = KRW 4,495.5, stored 4,496. EUR 5 x 1500 = 7,500 against
		// USD 5.56 x 1350 = 7,506: 6 apart. Tolerance: dust 1 + 2 x 0.5 + cash (0.5 + 0.01 x 1350) = 16.
		const base = {
			currency: "KRW",
			paid: "4496",
			cashUsd: "3.33",
			usd: "1350",
			eur: "1500",
		};
		expect(await cross({ ...base, mine: "5.56" })).toBe(true);
		// USD 5.70 x 1350 = 7,695: 195 apart.
		expect(await cross({ ...base, mine: "5.70" })).toBe(false);
	});
});

describe("the smallest unit of the payment currency", () => {
	const oneEach = (
		currency: string,
		theirs: string | null,
		mine: string | null,
	) =>
		went(() =>
			record(
				ana,
				header(ana, ana, ben, "PROPOSED", { currency, amount: "1" }),
				(id) => [
					row(id, ana, ben, { ...claim, amount: "1", currency }),
					...(theirs
						? [
								row(id, ben, ana, {
									status: "PROPOSED" as const,
									confirmedByPayee: true,
									isOffset: true,
									amount: theirs,
									currency,
								}),
							]
						: []),
					...(mine
						? [
								row(id, ana, ben, {
									...claim,
									isOffset: true,
									amount: mine,
									currency,
								}),
							]
						: []),
				],
			),
		);

	it("holds a payment in ETH to 1e-8, not to cents", async () => {
		// Tolerance: dust 1e-8 + 2 offsets x 0.5e-8 = 2e-8.
		expect(await oneEach("ETH", "0.0005", "0.0005")).toBe(true);
		expect(await oneEach("ETH", "0.004", null)).toBe(false);
		expect(await oneEach("ETH", "0.0005", "0.0005001")).toBe(false);
	});

	it("keeps cents for a stablecoin", async () => {
		// Tolerance: dust 0.01 + 2 x 0.005 = 0.02.
		expect(await oneEach("USDC", "1", "1.015")).toBe(true);
		expect(await oneEach("USDC", "1", "1.03")).toBe(false);
	});
});
