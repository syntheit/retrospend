/**
 * The web's delete of a recurring template and its Undo on real Postgres
 * (recurring-delete-web.service.ts), the same mutations /api/v1 runs.
 *
 * ARS home. A budget with Rent (a 500.00 monthly target) and Dining (200.00),
 * and a monthly template "Rent" of ARS 3,000.00 that the Rent envelope follows
 * as a BILL, so its target is the template's. Expected values by hand
 * (minor units, 2 decimals):
 *
 *   Plan cost: Rent follows the template 300,000 + Dining 20,000 = 320,000.
 *   Delete: the link is cleared, Rent has no target of its own left (a BILL
 *   with no due date), so plan cost is Dining alone, 20,000; delta -300,000.
 *   Recurring cost a month: the template's 300,000, then 0; delta -300,000.
 *   Undo: the template and the link are back, plan cost 320,000 again.
 *
 * A template no envelope follows leaves the plan cost out of its preview.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { signRestore } from "~/server/services/entry/restore-token";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { addRow, setupInput } from "../envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import { NO_TARGET, replaceTarget } from "../envelope/target-write";
import {
	deleteTemplate,
	previewDeleteTemplate,
	previewRestoreTemplate,
	RECURRING_DELETE,
	restoreTemplate,
} from "../recurring-delete-web.service";

beforeAll(seedArsRates);

const ars = (minor: number) => ({ minor, currency: "ARS" });
const FIGURES = ["budget.planCost", "recurring.cost.out.month"] as const;

async function arsBook() {
	const { user } = await arsUser();
	const cat = (name: string) =>
		fixtureDb.category
			.create({ data: { name, color: "blue", userId: user.id } })
			.then((c) => c.id);
	const ids = { rent: await cat("Rent"), dining: await cat("Dining") };
	await forUser(user.id).apply(setupEnvelopeBook, {
		...setupInput(ids),
		timeZone: "UTC",
	});
	return user.id;
}

async function template(userId: string, name = "Rent") {
	const id = randomUUID();
	await fixtureDb.recurringTemplate.create({
		data: {
			id,
			userId,
			name,
			amount: "3000",
			currency: "ARS",
			frequency: "MONTHLY",
			direction: "OUT",
			nextDueDate: new Date(TODAY.getTime() + 5 * 86_400_000),
		},
	});
	return id;
}

/** The book of `arsBook` with its Rent envelope following a template. */
async function billed() {
	const userId = await arsBook();
	const id = await template(userId);
	// By its 500.00 target: the envelope's name may be sealed, which a filter cannot read.
	const envelopes = await adminDb.envelope.findMany({
		where: { book: { createdById: userId } },
	});
	const rent = envelopes.find((e) => e.targetAmount?.toString() === "500");
	if (!rent) throw new Error("no Rent envelope");
	await adminDb.envelope.update({
		where: { id: rent.id },
		// A bill that follows a template has no amount of its own.
		data: { kind: "BILL", targetTemplateId: id, targetAmount: null },
	});
	return { userId, id, rent: rent.id };
}

const read = async (userId: string) => {
	const f = await readFigures(userId, FIGURES);
	return {
		plan: f.get("budget.planCost"),
		cost: f.get("recurring.cost.out.month"),
	};
};

const ids = (d: {
	changes: readonly { id: string }[];
	unchanged: readonly { id: string }[];
}) => new Set([...d.changes, ...d.unchanged].map((x) => x.id));

describe("deleting a template the budget follows", () => {
	it("the preview names the plan cost and the cost, and is what the delete does", async () => {
		const { userId, id, rent } = await billed();
		expect(await read(userId)).toEqual({
			plan: [ars(320_000)],
			cost: [ars(300_000)],
		});

		const preview = await previewDeleteTemplate(adminDb, userId, id);
		const change = (figure: string) =>
			preview.changes.find((c) => c.id === figure);
		expect(change("budget.planCost")).toMatchObject({
			before: ars(320_000),
			after: ars(20_000),
			delta: ars(-300_000),
		});
		expect(change("recurring.cost.out.month")).toMatchObject({
			before: ars(300_000),
			after: ars(0),
			delta: ars(-300_000),
		});
		expect(preview.envelopeTargets).toBe(1);
		// A preview writes nothing.
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(1);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: id });

		const logged = await addRow(userId, { amount: 10 });
		await adminDb.expense.update({
			where: { id: logged.id },
			data: { recurringTemplateId: id },
		});

		await deleteTemplate(adminDb, userId, id);
		// What it logged stays, only its link to the template goes.
		await expect(
			adminDb.expense.findUniqueOrThrow({ where: { id: logged.id } }),
		).resolves.toMatchObject({ recurringTemplateId: null });
		expect(await read(userId)).toEqual({
			plan: [ars(20_000)],
			cost: [ars(0)],
		});
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(0);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: null });
	});

	it("the Undo puts the template and the link back, and its preview says so first", async () => {
		const { userId, id, rent } = await billed();
		const before = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		const logged = await addRow(userId, { amount: 10 });
		await adminDb.expense.update({
			where: { id: logged.id },
			data: { recurringTemplateId: id },
		});
		const { restore } = await deleteTemplate(adminDb, userId, id);

		const preview = await previewRestoreTemplate(userId, restore);
		expect(
			preview.changes.find((c) => c.id === "budget.planCost"),
		).toMatchObject({
			before: ars(20_000),
			after: ars(320_000),
			delta: ars(300_000),
		});
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(0);

		expect(preview.relinkedEnvelopes).toBe(1);
		await expect(restoreTemplate(adminDb, userId, restore)).resolves.toEqual({
			id,
		});
		const after = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		// The write stamps a new updatedAt; everything else is as it was, createdAt included.
		const { updatedAt: _then, ...was } = before;
		const { updatedAt: _now, ...is } = after;
		expect(is).toEqual(was);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: id });
		await expect(
			adminDb.expense.findUniqueOrThrow({ where: { id: logged.id } }),
		).resolves.toMatchObject({ recurringTemplateId: id });
		expect((await read(userId)).plan).toEqual([ars(320_000)]);
	});

	it("a bill the person gave a manual target since keeps it on Undo", async () => {
		const { userId, id, rent } = await billed();
		const { restore } = await deleteTemplate(adminDb, userId, id);
		// Rent now has a target of its own: 400.00 a month, due on the 15th.
		await adminDb.envelope.update({
			where: { id: rent },
			data: {
				targetAmount: "400",
				targetDueDate: new Date("2026-12-15T00:00:00Z"),
				targetRepeat: "MONTHLY",
			},
		});
		const planBefore = (await read(userId)).plan;

		const preview = await previewRestoreTemplate(userId, restore);
		expect(preview.relinkedEnvelopes).toBe(0);
		await restoreTemplate(adminDb, userId, restore);
		// The template is back, but Rent still follows its own 400.00, not the 3,000.00 one.
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: null });
		expect((await read(userId)).plan).toEqual(planBefore);
		expect((await read(userId)).plan).not.toEqual([ars(320_000)]);
	});

	it("a bill the person pointed at a debt since keeps it on Undo", async () => {
		const { userId, id, rent } = await billed();
		const { restore } = await deleteTemplate(adminDb, userId, id);
		// Rent now follows a 100,000.00 ARS loan, written the way "Set a target" writes it.
		const loan = await openAccount(
			userId,
			"Loan",
			"LIABILITY_LOAN",
			"ARS",
			100_000,
		);
		await adminDb.envelope.update({
			where: { id: rent },
			data: replaceTarget(
				{ kind: "BILL_LIABILITY", liabilityId: loan },
				"ARS",
				1,
			),
		});

		const preview = await previewRestoreTemplate(userId, restore);
		expect(preview.relinkedEnvelopes).toBe(0);
		await restoreTemplate(adminDb, userId, restore);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({
			kind: "BILL",
			targetTemplateId: null,
			targetLiabilityId: loan,
		});
	});

	it("an envelope the person set to No target since stays unlinked on Undo", async () => {
		const { userId, id, rent } = await billed();
		const { restore } = await deleteTemplate(adminDb, userId, id);
		// No target: the kind goes to NONE and every target column is clear.
		await adminDb.envelope.update({
			where: { id: rent },
			data: { ...NO_TARGET, kind: "NONE" },
		});

		const preview = await previewRestoreTemplate(userId, restore);
		expect(preview.relinkedEnvelopes).toBe(0);
		await restoreTemplate(adminDb, userId, restore);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ kind: "NONE", targetTemplateId: null });
	});

	it("a template no envelope follows leaves the plan cost out", async () => {
		const userId = await arsBook();
		const id = await template(userId, "Gym");
		const preview = await previewDeleteTemplate(adminDb, userId, id);
		expect(ids(preview).has("budget.planCost")).toBe(false);
		expect(preview.envelopeTargets).toBe(0);
		expect(
			preview.changes.find((c) => c.id === "recurring.cost.out.month")?.delta,
		).toEqual(ars(-300_000));
	});
});

describe("what the Undo refuses", () => {
	it("a template that is back already, for a token signed again", async () => {
		const { userId, id } = await billed();
		const { restore } = await deleteTemplate(adminDb, userId, id);
		await restoreTemplate(adminDb, userId, restore);
		// Edited to 4,000.00, so it is not the same one by hand: only the id can refuse.
		await fixtureDb.recurringTemplate.update({
			where: { id },
			data: { amount: "4000" },
		});
		// A fresh signature, so the single-use claim is not what refuses it.
		const again = signRestore(
			RECURRING_DELETE,
			userId,
			JSON.parse(restore.data).payload,
		);
		await expect(restoreTemplate(adminDb, userId, again)).rejects.toMatchObject(
			{ code: "CONFLICT", message: "This template is back already" },
		);
		// The edited template is left as it is.
		expect(
			(
				await fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } })
			).amount.toString(),
		).toBe("4000");
	});

	it("a token used once, even after the template was deleted again", async () => {
		const { userId, id } = await billed();
		const first = await deleteTemplate(adminDb, userId, id);
		await restoreTemplate(adminDb, userId, first.restore);
		// Edited since, then deleted again: the first token holds the old version.
		await fixtureDb.recurringTemplate.update({
			where: { id },
			data: { amount: "4000" },
		});
		const second = await deleteTemplate(adminDb, userId, id);
		await expect(
			restoreTemplate(adminDb, userId, first.restore),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(0);
		await restoreTemplate(adminDb, userId, second.restore);
		await expect(
			fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } }),
		).resolves.toMatchObject({ amount: expect.anything() });
		expect(
			(
				await fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } })
			).amount.toString(),
		).toBe("4000");
	});

	it("a template made again by hand since", async () => {
		const userId = await arsBook();
		const id = await template(userId, "Gym");
		const { restore } = await deleteTemplate(adminDb, userId, id);
		await template(userId, "gym");
		await expect(
			restoreTemplate(adminDb, userId, restore),
		).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			fixtureDb.recurringTemplate.count({ where: { userId } }),
		).resolves.toBe(1);
	});

	it("a forged token, another user's, an expired one and another kind", async () => {
		const { userId, id } = await billed();
		const { restore } = await deleteTemplate(adminDb, userId, id);
		const other = await arsBook();
		const bad = { code: "BAD_REQUEST" };
		await expect(
			restoreTemplate(adminDb, userId, { ...restore, sig: "0".repeat(64) }),
		).rejects.toMatchObject(bad);
		await expect(
			restoreTemplate(adminDb, other, restore),
		).rejects.toMatchObject(bad);
		const snapshot = JSON.parse(restore.data).payload;
		await expect(
			restoreTemplate(
				adminDb,
				userId,
				signRestore(
					RECURRING_DELETE,
					userId,
					snapshot,
					Date.now() - 25 * 3_600_000,
				),
			),
		).rejects.toMatchObject(bad);
		await expect(
			restoreTemplate(
				adminDb,
				userId,
				signRestore("expense.delete", userId, snapshot),
			),
		).rejects.toMatchObject(bad);
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(0);
	});
});

describe("whose template it is", () => {
	it("another user's template is not found, and nothing moves", async () => {
		const mine = await arsBook();
		const id = await template(mine);
		const theirs = await arsBook();
		await expect(
			previewDeleteTemplate(adminDb, theirs, id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(deleteTemplate(adminDb, theirs, id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			fixtureDb.recurringTemplate.count({ where: { id } }),
		).resolves.toBe(1);
	});
});
