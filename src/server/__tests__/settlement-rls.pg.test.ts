/**
 * Who may write a payment (payment, settlement) and its audit trail, on
 * Postgres through the scoped client (role retrospend_app, app.current_user_id
 * = the caller). RLS must hold on its own, whatever the app checks first.
 *
 * A payment has a recorder (the person who entered it) and a receiver (the
 * other party, who confirms or rejects it). Money columns never change after
 * creation. Status moves only: PROPOSED to FINALIZED or REJECTED by the
 * receiver, and FINALIZED back to PROPOSED by the receiver (the confirm undo).
 * Audit entries of a payment are written in your own name, and a SETTLED entry
 * (the record confirm-restore restores from) only by the receiver.
 *
 * A payment is checked as a whole at commit (a header has rows, the rows share
 * its status), so the tests write it the way the app does: in one transaction.
 * settlement-probes.pg.test.ts holds the attacks on that.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	previousOf,
	readPrevious,
} from "~/server/services/payments/confirm-restore";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { Prisma, SettlementStatus } from "~prisma";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser; // pays
let ben: TestUser; // receives
let cam: TestUser; // shares a project with both, party to nothing here
let projectId: string;

type Shape = "pending" | "received" | "mutual" | "rejected";

/** A payment from `payer` to `payee` of USD 100, in one of the four states the app leaves it in. */
async function payment(shape: Shape, payer = ana, payee = ben) {
	const paymentId = randomUUID();
	const byPayee = shape === "received";
	await adminDb.payment.create({
		data: {
			id: paymentId,
			payerType: "user",
			payerId: payer.user.id,
			payeeType: "user",
			payeeId: payee.user.id,
			amount: "100",
			currency: "USD",
			paidOn: new Date("2026-10-10"),
			recordedByType: "user",
			recordedById: (byPayee ? payee : payer).user.id,
			status:
				shape === "pending"
					? "PROPOSED"
					: shape === "rejected"
						? "REJECTED"
						: "FINALIZED",
		},
	});
	const status: SettlementStatus =
		shape === "pending"
			? "PROPOSED"
			: shape === "rejected"
				? "REJECTED"
				: "FINALIZED";
	const row = await adminDb.settlement.create({
		data: {
			paymentGroupId: paymentId,
			fromParticipantType: "user",
			fromParticipantId: payer.user.id,
			toParticipantType: "user",
			toParticipantId: payee.user.id,
			amount: "100",
			currency: "USD",
			status,
			confirmedByPayer: shape !== "received",
			confirmedByPayee: shape === "mutual" || shape === "received",
			autoConfirmedReason: byPayee
				? "Recorded by the payee as a payment received"
				: null,
			settledAt: status === "FINALIZED" ? new Date() : null,
			rejectedAt: status === "REJECTED" ? new Date() : null,
		},
	});
	return { paymentId, row };
}

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

/** One transaction as `who`, the way the app writes a payment. */
const inTx = <T>(
	who: TestUser,
	run: (tx: Prisma.TransactionClient) => Promise<T>,
) => who.db.$transaction(run);

const rowOf = (id: string) =>
	adminDb.settlement.findUniqueOrThrow({ where: { id } });
const exists = async (id: string) =>
	(await adminDb.settlement.count({ where: { id } })) === 1;

const entry = (
	actor: TestUser,
	targetId: string,
	action: "CREATED" | "SETTLED" | "DELETED" | "EDITED",
) => ({
	actorType: "user" as const,
	actorId: actor.user.id,
	action,
	targetType: "SETTLEMENT" as const,
	targetId,
	changes: { amount: 100 },
});

/**
 * The receiver's confirm as the app writes it: rows and header final, then the
 * SETTLED entry with the claim as it was, all in one transaction.
 */
async function confirmWithEntry(p: { paymentId: string; row: { id: string } }) {
	const [before, rows] = await Promise.all([
		adminDb.payment.findUniqueOrThrow({ where: { id: p.paymentId } }),
		adminDb.settlement.findMany({ where: { paymentGroupId: p.paymentId } }),
	]);
	await inTx(ben, async (tx) => {
		await tx.settlement.updateMany({
			where: { paymentGroupId: p.paymentId },
			data: {
				status: "FINALIZED",
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date(),
			},
		});
		await tx.payment.update({
			where: { id: p.paymentId },
			data: { status: "FINALIZED" },
		});
		await tx.auditLogEntry.create({
			data: {
				...entry(ben, p.row.id, "SETTLED"),
				changes: {
					paymentGroupId: p.paymentId,
					amount: 100,
					previous: previousOf(before, rows, "[]") as unknown as Prisma.InputJsonValue,
				},
			},
		});
	});
	return { before, rows };
}

beforeAll(async () => {
	ana = await createTestUser();
	ben = await createTestUser();
	cam = await createTestUser();
	const project = await adminDb.project.create({
		data: { name: "Trip", createdById: ana.user.id },
	});
	projectId = project.id;
	for (const u of [ana, ben, cam]) {
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "user",
				participantId: u.user.id,
				role: "EDITOR",
			},
		});
	}
});

describe("money columns never change after creation", () => {
	it.each([
		["amount", { amount: "1" }],
		["currency", { currency: "ARS" }],
		["converted amount", { convertedAmount: "1", convertedCurrency: "ARS" }],
		["rate", { exchangeRateUsed: "2" }],
		["project", () => ({ projectId })],
		["offset flag", { isOffset: true }],
		["kind", { kind: "FORGIVE" as const }],
	])("refuses a party changing the %s", async (_name, change) => {
		const data = typeof change === "function" ? change() : change;
		for (const [shape, who] of [
			["pending", ana],
			["pending", ben],
			["mutual", ana],
			["mutual", ben],
			["received", ana],
		] as const) {
			const { row } = await payment(shape);
			expect(
				await went(() =>
					who.db.settlement.update({ where: { id: row.id }, data }),
				),
			).toBe(false);
			const after = await rowOf(row.id);
			expect(after.amount.toString()).toBe("100");
			expect(after.currency).toBe("USD");
		}
	});

	it("refuses re-pointing a row at other people", async () => {
		const { row } = await payment("pending");
		const moves = [
			{ toParticipantId: cam.user.id },
			{ fromParticipantId: cam.user.id },
			{ toParticipantType: "shadow" as const },
			{ paymentGroupId: randomUUID() },
		];
		for (const data of moves) {
			expect(
				await went(() =>
					ana.db.settlement.update({ where: { id: row.id }, data }),
				),
			).toBe(false);
			expect(
				await went(() =>
					ben.db.settlement.update({ where: { id: row.id }, data }),
				),
			).toBe(false);
		}
		const after = await rowOf(row.id);
		expect(after.toParticipantId).toBe(ben.user.id);
		expect(after.fromParticipantId).toBe(ana.user.id);
	});

	it("refuses a project member who is not a party touching the row at all", async () => {
		const { row } = await payment("pending");
		expect(
			await went(() =>
				cam.db.settlement.updateMany({
					where: { id: row.id },
					data: { note: "x" },
				}),
			),
		).toBe(false);
		expect(
			await went(() => cam.db.settlement.deleteMany({ where: { id: row.id } })),
		).toBe(false);
		expect(await exists(row.id)).toBe(true);
		const paid = await adminDb.payment.findFirstOrThrow({
			where: { settlements: { some: { id: row.id } } },
		});
		expect(
			await went(() => cam.db.payment.deleteMany({ where: { id: paid.id } })),
		).toBe(false);
		expect(
			await went(() =>
				cam.db.payment.updateMany({
					where: { id: paid.id },
					data: { amount: "1" },
				}),
			),
		).toBe(false);
		// Still readable: the project feed shows it.
		expect(await cam.db.settlement.count({ where: { id: row.id } })).toBe(1);
	});

	it("refuses the payment header changing its parties or currency", async () => {
		const { paymentId } = await payment("pending");
		for (const data of [
			{ payeeId: cam.user.id },
			{ payerId: cam.user.id },
			{ currency: "ARS" },
			{ recordedById: ben.user.id },
		]) {
			expect(
				await went(() =>
					ana.db.payment.update({ where: { id: paymentId }, data }),
				),
			).toBe(false);
			expect(
				await went(() =>
					ben.db.payment.update({ where: { id: paymentId }, data }),
				),
			).toBe(false);
		}
	});

	it("refuses the recorder changing the header amount", async () => {
		const { paymentId } = await payment("pending");
		expect(
			await went(() =>
				ana.db.payment.update({
					where: { id: paymentId },
					data: { amount: "1" },
				}),
			),
		).toBe(false);
	});
});

describe("status moves only the legal way", () => {
	const confirmed = {
		status: "FINALIZED" as const,
		confirmedByPayer: true,
		confirmedByPayee: true,
		settledAt: new Date(),
	};

	it("lets the receiver confirm, and the recorder not", async () => {
		const mine = await payment("pending");
		expect(
			await went(() =>
				ana.db.settlement.update({
					where: { id: mine.row.id },
					data: confirmed,
				}),
			),
		).toBe(false);
		expect((await rowOf(mine.row.id)).status).toBe("PROPOSED");
		await inTx(ben, async (tx) => {
			await tx.settlement.update({
				where: { id: mine.row.id },
				data: confirmed,
			});
			await tx.payment.update({
				where: { id: mine.paymentId },
				data: { status: "FINALIZED" },
			});
		});
		expect((await rowOf(mine.row.id)).status).toBe("FINALIZED");
	});

	it("lets the receiver confirm with a new method and header, as payment.confirm does", async () => {
		const p = await payment("pending");
		await inTx(ben, async (tx) => {
			await tx.settlement.updateMany({
				where: { id: p.row.id, status: "PROPOSED" },
				data: confirmed,
			});
			await tx.payment.update({
				where: { id: p.paymentId },
				data: {
					status: "FINALIZED",
					paidOn: new Date("2026-10-11"),
					paymentMethod: "Cash",
				},
			});
			await tx.settlement.updateMany({
				where: { paymentGroupId: p.paymentId },
				data: { paymentMethod: "Cash" },
			});
		});
		expect((await rowOf(p.row.id)).paymentMethod).toBe("Cash");
	});

	it("lets the receiver reject, and the recorder not", async () => {
		const p = await payment("pending");
		const rejected = {
			status: "REJECTED" as const,
			rejectedAt: new Date(),
			rejectedReason: "Never came",
		};
		expect(
			await went(() =>
				ana.db.settlement.update({ where: { id: p.row.id }, data: rejected }),
			),
		).toBe(false);
		await inTx(ben, async (tx) => {
			await tx.settlement.update({ where: { id: p.row.id }, data: rejected });
			await tx.payment.update({
				where: { id: p.paymentId },
				data: { status: "REJECTED" },
			});
		});
		expect((await rowOf(p.row.id)).status).toBe("REJECTED");
	});

	it("refuses a confirm that skips the flags or fakes who agreed", async () => {
		const p = await payment("pending");
		for (const data of [
			{ status: "FINALIZED" as const },
			{
				status: "FINALIZED" as const,
				confirmedByPayer: true,
				confirmedByPayee: false,
			},
			{
				...confirmed,
				autoConfirmedReason: "Recipient is a shadow and cannot confirm",
			},
		]) {
			expect(
				await went(() =>
					ben.db.settlement.update({ where: { id: p.row.id }, data }),
				),
			).toBe(false);
		}
		expect((await rowOf(p.row.id)).status).toBe("PROPOSED");
	});

	it("refuses flipping flags without a status change", async () => {
		const p = await payment("pending");
		expect(
			await went(() =>
				ana.db.settlement.update({
					where: { id: p.row.id },
					data: { confirmedByPayee: true },
				}),
			),
		).toBe(false);
		expect(
			await went(() =>
				ben.db.settlement.update({
					where: { id: p.row.id },
					data: { confirmedByPayee: true },
				}),
			),
		).toBe(false);
	});

	it("refuses a rejected payment coming back, and a confirmed one being rejected", async () => {
		const rejected = await payment("rejected");
		expect(
			await went(() =>
				ben.db.settlement.update({
					where: { id: rejected.row.id },
					data: confirmed,
				}),
			),
		).toBe(false);
		expect(
			await went(() =>
				ana.db.settlement.update({
					where: { id: rejected.row.id },
					data: { status: "PROPOSED", rejectedAt: null },
				}),
			),
		).toBe(false);
		const mutual = await payment("mutual");
		expect(
			await went(() =>
				ben.db.settlement.update({
					where: { id: mutual.row.id },
					data: { status: "REJECTED", rejectedAt: new Date() },
				}),
			),
		).toBe(false);
		expect((await rowOf(mutual.row.id)).status).toBe("FINALIZED");
	});

	it("lets the receiver take a confirm back, and the recorder not (the unconfirm path)", async () => {
		const p = await payment("mutual");
		const back = {
			status: "PROPOSED" as const,
			settledAt: null,
			confirmedByPayer: true,
			confirmedByPayee: false,
		};
		expect(
			await went(() =>
				ana.db.settlement.update({ where: { id: p.row.id }, data: back }),
			),
		).toBe(false);
		await inTx(ben, async (tx) => {
			await tx.settlement.update({ where: { id: p.row.id }, data: back });
			await tx.payment.update({
				where: { id: p.paymentId },
				data: { status: "PROPOSED" },
			});
		});
		expect((await rowOf(p.row.id)).status).toBe("PROPOSED");
	});

	it("never reopens a payment the receiver recorded themselves", async () => {
		const p = await payment("received");
		const back = {
			status: "PROPOSED" as const,
			settledAt: null,
			confirmedByPayer: false,
			confirmedByPayee: true,
		};
		expect(
			await went(() =>
				ana.db.settlement.update({ where: { id: p.row.id }, data: back }),
			),
		).toBe(false);
		expect(
			await went(() =>
				ana.db.payment.update({
					where: { id: p.paymentId },
					data: { status: "PROPOSED" },
				}),
			),
		).toBe(false);
	});

	it("lets the recorder send reminders and either party add a note", async () => {
		const p = await payment("pending");
		await ana.db.settlement.updateMany({
			where: { id: p.row.id },
			data: { reminderSentAt: new Date(), reminderCount: 1 },
		});
		await ben.db.settlement.update({
			where: { id: p.row.id },
			data: { note: "Thanks" },
		});
		expect((await rowOf(p.row.id)).reminderCount).toBe(1);
	});
});

describe("inserting a payment", () => {
	const base = (payer: TestUser, payee: TestUser, paymentGroupId: string) => ({
		paymentGroupId,
		fromParticipantType: "user" as const,
		fromParticipantId: payer.user.id,
		toParticipantType: "user" as const,
		toParticipantId: payee.user.id,
		amount: "5",
		currency: "USD",
	});
	const header = (
		recorder: TestUser,
		payer: TestUser,
		payee: TestUser,
		id = randomUUID(),
	) => ({
		id,
		payerType: "user" as const,
		payerId: payer.user.id,
		payeeType: "user" as const,
		payeeId: payee.user.id,
		amount: "5",
		currency: "USD",
		paidOn: new Date("2026-10-10"),
		recordedByType: "user" as const,
		recordedById: recorder.user.id,
		status: "PROPOSED" as const,
	});
	/** A pending header with no rows yet, made by the owner connection (a setup only). */
	const bareHeader = (
		payer: TestUser,
		payee: TestUser,
		id: ReturnType<typeof randomUUID>,
	) =>
		adminDb.payment.create({ data: header(payer, payer, payee, id) });

	it("lets the payer record a pending payment, and the payee record one received", async () => {
		const id = randomUUID();
		await inTx(ana, async (tx) => {
			await tx.payment.create({ data: header(ana, ana, ben, id) });
			await tx.settlement.create({
				data: {
					...base(ana, ben, id),
					status: "PROPOSED",
					confirmedByPayer: true,
					confirmedByPayee: false,
				},
			});
		});
		const idB = randomUUID();
		await inTx(ben, async (tx) => {
			await tx.payment.create({
				data: { ...header(ben, ana, ben, idB), status: "FINALIZED" },
			});
			await tx.settlement.create({
				data: {
					...base(ana, ben, idB),
					status: "FINALIZED",
					confirmedByPayer: false,
					confirmedByPayee: true,
					autoConfirmedReason: "Recorded by the payee as a payment received",
					settledAt: new Date(),
				},
			});
		});
		expect(await adminDb.settlement.count({ where: { paymentGroupId: id } })).toBe(1);
		expect(await adminDb.settlement.count({ where: { paymentGroupId: idB } })).toBe(1);
	});

	it("lets the payer record a payment to a shadow person as final at once", async () => {
		const shadow = await adminDb.shadowProfile.create({
			data: { name: "Gus", createdById: ana.user.id },
		});
		const id = randomUUID();
		await inTx(ana, async (tx) => {
			await tx.payment.create({
				data: {
					...header(ana, ana, ben, id),
					payeeType: "shadow",
					payeeId: shadow.id,
					status: "FINALIZED",
				},
			});
			await tx.settlement.create({
				data: {
					...base(ana, ben, id),
					toParticipantType: "shadow",
					toParticipantId: shadow.id,
					status: "FINALIZED",
					confirmedByPayer: true,
					confirmedByPayee: true,
					autoConfirmedReason: "Recipient is a shadow and cannot confirm",
					settledAt: new Date(),
				},
			});
		});
		expect(await adminDb.settlement.count({ where: { paymentGroupId: id } })).toBe(1);
	});

	it("refuses a payer making a payment to a real user final without them", async () => {
		const id = randomUUID();
		await bareHeader(ana, ben, id);
		for (const extra of [
			{
				status: "FINALIZED" as const,
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date(),
			},
			{
				status: "FINALIZED" as const,
				confirmedByPayer: true,
				confirmedByPayee: true,
				autoConfirmedReason: "Recipient is a shadow and cannot confirm",
			},
			{
				status: "PROPOSED" as const,
				confirmedByPayer: true,
				confirmedByPayee: true,
			},
			{
				status: "PROPOSED" as const,
				confirmedByPayer: false,
				confirmedByPayee: true,
			},
		]) {
			expect(
				await went(() =>
					ana.db.settlement.create({
						data: { ...base(ana, ben, id), ...extra },
					}),
				),
			).toBe(false);
		}
		expect(
			await adminDb.settlement.count({ where: { paymentGroupId: id } }),
		).toBe(0);
	});

	it("refuses recording a payment in someone else's name", async () => {
		// A header recorded by Ben, written by Ana.
		expect(
			await went(() => ana.db.payment.create({ data: header(ben, ana, ben) })),
		).toBe(false);
		// A header between two people Ana is not one of.
		expect(
			await went(() => cam.db.payment.create({ data: header(cam, ana, ben) })),
		).toBe(false);
	});

	it("refuses the payee recording a payment as waiting for the payer", async () => {
		expect(
			await went(() => ben.db.payment.create({ data: header(ben, ana, ben) })),
		).toBe(false);
	});

	it("refuses a row that names other people than its payment", async () => {
		const id = randomUUID();
		await bareHeader(ana, ben, id);
		expect(
			await went(() =>
				ana.db.settlement.create({
					data: {
						...base(ana, cam, id),
						status: "PROPOSED",
						confirmedByPayer: true,
						confirmedByPayee: false,
					},
				}),
			),
		).toBe(false);
	});

	it("refuses a row with no payment header", async () => {
		expect(
			await went(() =>
				ana.db.settlement.create({
					data: {
						...base(ana, ben, randomUUID()),
						status: "PROPOSED",
						confirmedByPayer: true,
						confirmedByPayee: false,
					},
				}),
			),
		).toBe(false);
	});

	it("refuses a header written alone, and rows written without their header's status", async () => {
		expect(
			await went(() => ana.db.payment.create({ data: header(ana, ana, ben) })),
		).toBe(false);
		const mutual = await payment("mutual");
		expect(
			await went(() =>
				ben.db.settlement.create({
					data: {
						...base(ana, ben, mutual.paymentId),
						status: "PROPOSED",
						confirmedByPayer: true,
						confirmedByPayee: false,
					},
				}),
			),
		).toBe(false);
	});
});

describe("deleting a payment", () => {
	it("lets the recorder delete a pending one, rows then header", async () => {
		const p = await payment("pending");
		await inTx(ana, async (tx) => {
			await tx.settlement.deleteMany({
				where: { id: p.row.id, status: { in: ["PROPOSED", "REJECTED"] } },
			});
			await tx.payment.deleteMany({ where: { id: p.paymentId } });
		});
		expect(await exists(p.row.id)).toBe(false);
		expect(await adminDb.payment.count({ where: { id: p.paymentId } })).toBe(0);
	});

	it("lets the receiver replace the rows of a pending payment (confirm with a new amount)", async () => {
		const p = await payment("pending");
		await inTx(ben, async (tx) => {
			await tx.settlement.deleteMany({
				where: { paymentGroupId: p.paymentId },
			});
			await tx.settlement.create({
				data: {
					paymentGroupId: p.paymentId,
					fromParticipantType: "user",
					fromParticipantId: ana.user.id,
					toParticipantType: "user",
					toParticipantId: ben.user.id,
					amount: "60",
					currency: "USD",
					status: "FINALIZED",
					confirmedByPayer: true,
					confirmedByPayee: true,
					settledAt: new Date(),
				},
			});
			await tx.payment.update({
				where: { id: p.paymentId },
				data: { status: "FINALIZED", amount: "60" },
			});
		});
		expect(await exists(p.row.id)).toBe(false);
		const rows = await adminDb.settlement.findMany({
			where: { paymentGroupId: p.paymentId },
		});
		expect(rows.map((r) => r.amount.toString())).toEqual(["60"]);
	});

	it("refuses the receiver deleting the rows of a payment and leaving it empty", async () => {
		const p = await payment("pending");
		expect(
			await went(() =>
				ben.db.settlement.deleteMany({ where: { paymentGroupId: p.paymentId } }),
			),
		).toBe(false);
		expect(await exists(p.row.id)).toBe(true);
	});

	it("lets the recorder void a payment that became final without the other side", async () => {
		const p = await payment("received");
		await inTx(ben, async (tx) => {
			await tx.settlement.deleteMany({ where: { id: p.row.id } });
			await tx.payment.deleteMany({ where: { id: p.paymentId } });
		});
		expect(await exists(p.row.id)).toBe(false);
	});

	it("refuses the payer voiding a payment the payee recorded", async () => {
		const p = await payment("received");
		expect(
			await went(() =>
				ana.db.settlement.deleteMany({ where: { id: p.row.id } }),
			),
		).toBe(false);
		expect(await exists(p.row.id)).toBe(true);
	});

	it("refuses the payer deleting a payment both confirmed, rows or header", async () => {
		const p = await payment("mutual");
		expect(
			await went(() =>
				ana.db.settlement.deleteMany({ where: { id: p.row.id } }),
			),
		).toBe(false);
		expect(
			await went(() =>
				ana.db.payment.deleteMany({ where: { id: p.paymentId } }),
			),
		).toBe(false);
		expect(await exists(p.row.id)).toBe(true);
	});

	it("keeps rows when a header with rows is deleted (no cascade around the row rules)", async () => {
		const p = await payment("mutual");
		expect(
			await went(() =>
				ben.db.payment.deleteMany({ where: { id: p.paymentId } }),
			),
		).toBe(false);
		expect(await exists(p.row.id)).toBe(true);
	});

	it("lets the receiver undo their own confirm: delete and put the claim back", async () => {
		const p = await payment("pending");
		await confirmWithEntry(p);
		await inTx(ben, async (tx) => {
			await tx.settlement.deleteMany({
				where: { paymentGroupId: p.paymentId },
			});
			await tx.settlement.createMany({
				data: [
					{
						id: p.row.id,
						paymentGroupId: p.paymentId,
						fromParticipantType: "user",
						fromParticipantId: ana.user.id,
						toParticipantType: "user",
						toParticipantId: ben.user.id,
						amount: "100",
						currency: "USD",
						status: "PROPOSED",
						confirmedByPayer: true,
						confirmedByPayee: false,
					},
				],
			});
			await tx.payment.update({
				where: { id: p.paymentId },
				data: { status: "PROPOSED" },
			});
		});
		expect(await exists(p.row.id)).toBe(true);
		expect((await rowOf(p.row.id)).status).toBe("PROPOSED");
	});

	it("lets the recorder clear a payment the other side rejected", async () => {
		const p = await payment("rejected");
		await inTx(ana, async (tx) => {
			await tx.settlement.deleteMany({ where: { id: p.row.id } });
			await tx.payment.deleteMany({ where: { id: p.paymentId } });
		});
		expect(await exists(p.row.id)).toBe(false);
	});

	it("refuses the receiver deleting a payment's header, even once its rows are gone", async () => {
		const p = await payment("rejected");
		expect(
			await went(() =>
				inTx(ben, async (tx) => {
					await tx.settlement.deleteMany({ where: { id: p.row.id } });
					await tx.payment.deleteMany({ where: { id: p.paymentId } });
				}),
			),
		).toBe(false);
		expect(await exists(p.row.id)).toBe(true);
	});

	it("lets a user void a payment a guest recorded as received", async () => {
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
		const row = await adminDb.settlement.create({
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
		await inTx(ana, async (tx) => {
			await tx.settlement.deleteMany({ where: { id: row.id } });
			await tx.payment.deleteMany({ where: { id } });
		});
		expect(await exists(row.id)).toBe(false);
	});
});

describe("audit entries of a payment", () => {
	it("lets the recorder log in their own name", async () => {
		const p = await payment("pending");
		for (const action of ["CREATED", "DELETED", "EDITED"] as const) {
			await ana.db.auditLogEntry.create({ data: entry(ana, p.row.id, action) });
		}
	});

	it("refuses a SETTLED entry from the recorder, who does not confirm", async () => {
		const p = await payment("pending");
		expect(
			await went(() =>
				ana.db.auditLogEntry.create({ data: entry(ana, p.row.id, "SETTLED") }),
			),
		).toBe(false);
		const received = await payment("received");
		expect(
			await went(() =>
				ben.db.auditLogEntry.create({
					data: entry(ben, received.row.id, "SETTLED"),
				}),
			),
		).toBe(false);
	});

	it("lets the receiver log SETTLED in their own name, as they confirm", async () => {
		const p = await payment("pending");
		await confirmWithEntry(p);
		expect(
			await adminDb.auditLogEntry.count({
				where: { targetId: p.row.id, action: "SETTLED" },
			}),
		).toBe(1);
	});

	it("refuses SETTLED for a payment that was confirmed in an earlier transaction", async () => {
		const p = await payment("mutual");
		expect(
			await went(() =>
				ben.db.auditLogEntry.create({
					data: entry(ben, p.row.id, "SETTLED"),
				}),
			),
		).toBe(false);
	});

	it("refuses a SETTLED entry from someone who is not a party", async () => {
		const p = await payment("mutual");
		expect(
			await went(() =>
				cam.db.auditLogEntry.create({ data: entry(cam, p.row.id, "SETTLED") }),
			),
		).toBe(false);
	});

	it("allows another party's name only on CREATED (the receiver rewriting rows)", async () => {
		const p = await payment("pending");
		await ben.db.auditLogEntry.create({
			data: entry(ana, p.row.id, "CREATED"),
		});
		for (const action of ["SETTLED", "DELETED", "EDITED"] as const) {
			expect(
				await went(() =>
					ben.db.auditLogEntry.create({ data: entry(ana, p.row.id, action) }),
				),
			).toBe(false);
		}
	});

	it("refuses any entry in the name of someone who is not a party", async () => {
		const p = await payment("pending");
		expect(
			await went(() =>
				cam.db.auditLogEntry.create({ data: entry(ana, p.row.id, "CREATED") }),
			),
		).toBe(false);
	});

	it("cannot feed a forged SETTLED entry to the confirm undo", async () => {
		const p = await payment("pending");
		await confirmWithEntry(p);
		const forged = {
			previous: {
				amount: "1",
				paidOn: "2026-10-10",
				ledger: "[]",
				rows: [{ id: p.row.id, amount: "1" }],
			},
		};
		expect(
			await went(() =>
				ana.db.auditLogEntry.create({
					data: { ...entry(ana, p.row.id, "SETTLED"), changes: forged },
				}),
			),
		).toBe(false);
		expect(
			await went(() =>
				ana.db.auditLogEntry.create({
					data: { ...entry(ben, p.row.id, "SETTLED"), changes: forged },
				}),
			),
		).toBe(false);
		const previous = await ben.db.$transaction((tx) =>
			readPrevious(tx, [p.row.id]),
		);
		expect(previous?.amount).toBe("100");
	});
});

describe("a refused audit write", () => {
	it("fails the caller and rolls its transaction back", async () => {
		const p = await payment("pending");
		await expect(
			ana.db.$transaction(async (tx) => {
				await tx.settlement.update({
					where: { id: p.row.id },
					data: { note: "changed in the same transaction" },
				});
				// Ana writes an entry in Ben's name for an action only Ben's own session may log.
				await logAudit(tx, {
					actor: { participantType: "user", participantId: ben.user.id },
					action: "SETTLED",
					targetType: "SETTLEMENT",
					targetId: p.row.id,
				});
			}),
		).rejects.toThrow(/row-level security/);
		expect((await rowOf(p.row.id)).note).toBeNull();
	});
});
