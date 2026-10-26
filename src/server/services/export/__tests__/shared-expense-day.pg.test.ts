/**
 * A shared expense stored at 2026-10-08T02:30Z is still the evening of Oct 7
 * in Buenos Aires (UTC-3, no daylight saving), so every export row, CSV and
 * PDF, shows 2026-10-07. The account zip already dates expenses this way.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	exportCallerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "./export-fixture";
import { pdfText } from "./pdf-text";

const LATE = new Date("2026-10-08T02:30:00Z");

let ana: TestUser;
let ben: TestUser;
let projectId: string;
let caller: ReturnType<typeof exportCallerFor>;

beforeAll(async () => {
	ana = await namedUser("Ana");
	ben = await namedUser("Ben");
	const project = await adminDb.project.create({
		data: {
			name: "Salta",
			primaryCurrency: "ARS",
			createdById: ana.user.id,
		},
	});
	projectId = project.id;
	for (const [id, role] of [
		[ana.user.id, "ORGANIZER"],
		[ben.user.id, "EDITOR"],
	] as const) {
		await adminDb.projectParticipant.create({
			data: { projectId, participantType: "user", participantId: id, role },
		});
	}
	const A = { type: "user" as const, id: ana.user.id };
	const B = { type: "user" as const, id: ben.user.id };
	const tx = await seedExpense({
		description: "Cena tarde",
		amount: "9000",
		currency: "ARS",
		date: "2026-10-08",
		paidBy: A,
		projectId,
		splits: [
			{ who: A, share: "4500" },
			{ who: B, share: "4500" },
		],
	});
	await adminDb.sharedTransaction.update({
		where: { id: tx.id },
		data: { date: LATE },
	});
	caller = exportCallerFor(ana.user);
});

describe("shared expense export days", () => {
	it("dates a project CSV row by the user's day", async () => {
		const out = await caller.exportProjectExpenses({
			projectId,
			format: "csv",
		});
		expect(out.csv).toContain("\n2026-10-07,Cena tarde,9000,ARS,");
		expect(out.csv).not.toContain("2026-10-08,Cena tarde");
	});

	it("dates a person history CSV row by the user's day", async () => {
		const out = await caller.exportPersonHistory({
			participantType: "user",
			participantId: ben.user.id,
			format: "csv",
		});
		expect(out.csv).toContain("\n2026-10-07,Cena tarde,9000,ARS,");
	});

	it("dates the project PDF row by the user's day", async () => {
		const runs = pdfText(
			Buffer.from((await caller.exportProjectPdf({ projectId })).pdf, "base64"),
		);
		expect(runs).toContain("2026-10-07");
		expect(runs).not.toContain("2026-10-08");
	});

	it("dates the person PDF's first transaction by the user's day", async () => {
		const { pdf } = await caller.exportPersonPdf({
			participantType: "user",
			participantId: ben.user.id,
		});
		const runs = pdfText(Buffer.from(pdf, "base64"));
		expect(runs.some((run) => run.startsWith("Since 2026-10-07"))).toBe(true);
	});
});
