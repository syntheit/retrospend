/**
 * The files and the bulk answer, with a rejected share. Ana paid ARS 90 in a
 * project, split 30 each over Ana, Bruno and Caro, and Bruno REJECTED.
 *
 * - The project CSV's Split Details lists Bruno's share as 0.00 and the row's
 *   Status says Disputed, so the shares read as what the Summary charges.
 * - Ana's person PDF with Bruno reads his share as 0.00 and labels the
 *   expense Disputed; her own 30.00 is the only 30.00 on the row.
 * - Accept all skips a waiting share on a settled expense and answers the one
 *   on an open expense: 1 accepted, the locked one still PENDING.
 */
import { describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { exportPersonPdf } from "../export/person-pdf";
import { exportProjectExpenses } from "../export/project-csv";
import { pdfText } from "../export/__tests__/pdf-text";
import {
	addMember,
	namedUser,
	seedExpense,
	type TestUser,
} from "../project/__tests__/trip-fixture";
import { VerificationService } from "./verification.service";

const who = (u: TestUser) => ({ type: "user" as const, id: u.user.id });
const ref = (u: TestUser) => ({
	participantType: "user" as const,
	participantId: u.user.id,
});

async function scene(isLocked = false) {
	const [ana, bruno, caro] = [
		await namedUser("Ana"),
		await namedUser("Bruno"),
		await namedUser("Caro"),
	];
	const project = await adminDb.project.create({
		data: { name: "Asado", primaryCurrency: "ARS", createdById: ana.user.id },
	});
	await addMember(project.id, "user", ana.user.id, "ORGANIZER");
	await addMember(project.id, "user", bruno.user.id, "CONTRIBUTOR");
	await addMember(project.id, "user", caro.user.id, "CONTRIBUTOR");
	const expense = await seedExpense(project.id, {
		description: "Asado",
		amount: "90",
		currency: "ARS",
		date: "2026-10-08",
		paidBy: who(ana),
		isLocked,
		splits: [
			{ ...who(ana), share: "30" },
			{ ...who(bruno), share: "30", status: "REJECTED" },
			{ ...who(caro), share: "30" },
		],
	});
	return { ana, bruno, caro, project, expense };
}

describe("the project CSV", () => {
	it("lists a rejected share as 0.00 and the row as Disputed", async () => {
		const s = await scene();
		const { csv } = await exportProjectExpenses(
			{ db: s.ana.db as never, userId: s.ana.user.id, timeZone: "UTC" },
			{ projectId: s.project.id },
		);
		expect(csv).toContain("Ana: 30.00 ARS; Bruno: 0.00 ARS; Caro: 30.00 ARS");
		expect(csv).toContain("Disputed");
	});
});

describe("the person PDF", () => {
	it("reads the rejected share as 0.00 and labels the expense Disputed", async () => {
		const s = await scene();
		const { pdf } = await exportPersonPdf(
			{ db: s.ana.db as never, userId: s.ana.user.id, timeZone: "UTC" },
			ref(s.bruno),
		);
		const runs = pdfText(pdf);
		expect(runs).toContain("Asado (Disputed)");
		// Her 30.00 and his 0.00: no second 30.00 on the row.
		expect(runs.filter((r) => r === "30.00")).toHaveLength(1);
		expect(runs).toContain("0.00");
	});
});

describe("accept all", () => {
	it("skips a waiting share on a settled expense", async () => {
		const settled = await scene(true);
		const open = await scene(false);
		// Bruno's share waits on both (he had not answered), Caro stays accepted.
		for (const s of [settled, open])
			await adminDb.splitParticipant.updateMany({
				where: {
					transactionId: s.expense.id,
					participantId: s.bruno.user.id,
				},
				data: { verificationStatus: "PENDING" },
			});
		// One person on both: move the open expense's waiting share to the settled
		// scene's Bruno, so a single caller answers both.
		await adminDb.splitParticipant.updateMany({
			where: {
				transactionId: open.expense.id,
				participantId: open.bruno.user.id,
			},
			data: { participantId: settled.bruno.user.id },
		});
		const done = await new VerificationService(
			adminDb,
			ref(settled.bruno),
		).bulkAccept([settled.expense.id, open.expense.id]);
		expect(done).toEqual({ accepted: 1 });
		const status = async (id: string) =>
			(
				await adminDb.splitParticipant.findFirstOrThrow({
					where: { transactionId: id, participantId: settled.bruno.user.id },
				})
			).verificationStatus;
		expect(await status(settled.expense.id)).toBe("PENDING");
		expect(await status(open.expense.id)).toBe("ACCEPTED");
	});
});
