/**
 * The holders with a unique key or no foreign key, on a real Postgres:
 * budgets, envelope links, the analytics preference, income rules and drafts.
 * Each moves with the category and comes back with its undo.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import { arsUser, category, dry, run, undo } from "./__tests__/merge-kit";

const october = new Date("2026-10-01T00:00:00Z");
const november = new Date("2026-11-01T00:00:00Z");

describe("budgets", () => {
	let me: string;
	beforeAll(async () => {
		me = await arsUser();
	});

	it("keeps the target's budget for a month both budget, moves the rest, and the undo recreates the dropped one", async () => {
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const [oct, nov] = await Promise.all([
			adminDb.budget.create({
				data: { userId: me, categoryId: src.id, period: october, amount: "50" },
			}),
			adminDb.budget.create({
				data: {
					userId: me,
					categoryId: src.id,
					period: november,
					amount: "60",
				},
			}),
		]);
		await adminDb.budget.create({
			data: { userId: me, categoryId: tgt.id, period: october, amount: "200" },
		});

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.budget).toEqual({ moved: 1, dropped: 1 });
		const after = await adminDb.budget.findMany({
			where: { userId: me, categoryId: tgt.id },
			orderBy: { period: "asc" },
		});
		expect(after.map((b) => b.amount.toFixed())).toEqual(["200", "60"]);

		await undo(me, done.value.stash);
		const back = await adminDb.budget.findMany({
			where: { userId: me, categoryId: src.id },
			orderBy: { period: "asc" },
		});
		expect(back.map((b) => [b.id, b.amount.toFixed()])).toEqual([
			[oct.id, "50"],
			[nov.id, "60"],
		]);
		await expect(
			adminDb.budget.count({ where: { userId: me, categoryId: tgt.id } }),
		).resolves.toBe(1);
	});

	it("a delete drops every budget, since one with no category would read as global, and the undo brings them back", async () => {
		const src = await category(me, "Old");
		const b = await adminDb.budget.create({
			data: { userId: me, categoryId: src.id, period: october, amount: "75.5" },
		});
		const done = await run(me, src.id, null);
		await expect(adminDb.budget.count({ where: { id: b.id } })).resolves.toBe(
			0,
		);
		await undo(me, done.value.stash);
		await expect(
			adminDb.budget.findUniqueOrThrow({ where: { id: b.id } }),
		).resolves.toMatchObject({ categoryId: src.id });
	});
});

describe("the analytics preference", () => {
	it("the target's wins; the source's moves when the target has none; both come back", async () => {
		const me = await arsUser();
		const [a, b, c] = await Promise.all(
			["A", "B", "C"].map((n) => category(me, n)),
		);
		if (!a || !b || !c) throw new Error("seed");
		const pa = await adminDb.analyticsCategoryPreference.create({
			data: { userId: me, categoryId: a.id, isFlexible: true },
		});
		await adminDb.analyticsCategoryPreference.create({
			data: { userId: me, categoryId: b.id, isFlexible: false },
		});

		const dropped = await run(me, a.id, b.id);
		expect(dropped.value.counts.preference).toEqual({ moved: 0, dropped: 1 });
		await undo(me, dropped.value.stash);
		await expect(
			adminDb.analyticsCategoryPreference.findUniqueOrThrow({
				where: { id: pa.id },
			}),
		).resolves.toMatchObject({ categoryId: a.id, isFlexible: true });

		const moved = await run(me, a.id, c.id);
		expect(moved.value.counts.preference).toEqual({ moved: 1, dropped: 0 });
		await expect(
			adminDb.analyticsCategoryPreference.findUniqueOrThrow({
				where: { id: pa.id },
			}),
		).resolves.toMatchObject({ categoryId: c.id, isFlexible: true });
		await undo(me, moved.value.stash);
		await expect(
			adminDb.analyticsCategoryPreference.findUniqueOrThrow({
				where: { id: pa.id },
			}),
		).resolves.toMatchObject({ categoryId: a.id });
	});
});

async function bookFor() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const env = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	return { ...s, book, env: env as Record<string, string> };
}

describe("envelope links", () => {
	it("a category in another envelope than the target's follows the target's, and the undo recreates its link", async () => {
		const b = await bookFor();
		const link = await adminDb.envelopeCategory.findFirstOrThrow({
			where: { categoryId: b.rent },
		});

		const done = await run(b.user.id, b.rent, b.dining);

		expect(done.value.counts.envelopeLink).toEqual({ moved: 0, dropped: 1 });
		expect(done.value.rerouted).toEqual([
			{
				bookId: b.book.id,
				rows: "source",
				from: b.env.Rent,
				to: b.env.Dining,
			},
		]);
		await expect(
			adminDb.envelopeCategory.count({ where: { id: link.id } }),
		).resolves.toBe(0);

		await undo(b.user.id, done.value.stash);
		await expect(
			adminDb.envelopeCategory.findUniqueOrThrow({ where: { id: link.id } }),
		).resolves.toMatchObject({
			categoryId: b.rent,
			envelopeId: b.env.Rent,
			bookId: b.book.id,
		});
	});

	it("a link that moves onto a target with none takes the target's rows into its envelope, and the preview lists it as the write does", async () => {
		const b = await bookFor();
		const snacks = await category(b.user.id, "Snacks");
		const treats = await category(b.user.id, "Treats");
		const link = await adminDb.envelopeCategory.create({
			data: {
				bookId: b.book.id,
				envelopeId: b.env.Dining as string,
				categoryId: snacks.id,
			},
		});

		const preview = await dry(b.user.id, snacks.id, treats.id);
		const done = await run(b.user.id, snacks.id, treats.id);

		const moved = [
			{
				bookId: b.book.id,
				rows: "target",
				from: b.env.Spending,
				to: b.env.Dining,
			},
		];
		expect(done.value.counts.envelopeLink).toEqual({ moved: 1, dropped: 0 });
		expect(done.value.rerouted).toEqual(moved);
		expect(preview.value.rerouted).toEqual(moved);
		await expect(
			adminDb.envelopeCategory.findUniqueOrThrow({ where: { id: link.id } }),
		).resolves.toMatchObject({
			categoryId: treats.id,
			envelopeId: b.env.Dining,
		});
	});

	it("a delete sends the rows to Everything else and the undo links the category again", async () => {
		const b = await bookFor();
		const done = await run(b.user.id, b.dining, null);
		expect(done.value.rerouted).toEqual([
			{
				bookId: b.book.id,
				rows: "source",
				from: b.env.Dining,
				to: b.env.Spending,
			},
		]);
		await undo(b.user.id, done.value.stash);
		await expect(
			adminDb.envelopeCategory.count({
				where: { categoryId: b.dining, envelopeId: b.env.Dining },
			}),
		).resolves.toBe(1);
	});
});

describe("income rules", () => {
	async function ruleFor(
		bookId: string,
		envelopeId: string,
		categoryId: string,
	) {
		return fixtureDb.incomeRule.create({
			data: {
				id: randomUUID(),
				bookId,
				sortOrder: 0,
				name: "Gigs to Dining",
				matchKind: "CATEGORY",
				matchValue: categoryId,
				action: "REMAINDER",
				envelopeId,
			},
		});
	}

	it("moves the rule that names the category in the caller's own book and the undo points it back", async () => {
		const b = await bookFor();
		const gigs = await category(b.user.id, "Gigs", { kind: "INCOME" });
		const pay = await category(b.user.id, "Pay", { kind: "INCOME" });
		const rule = await ruleFor(b.book.id, b.env.Dining as string, gigs.id);

		const done = await run(b.user.id, gigs.id, pay.id);
		expect(done.value.counts.incomeRule.moved).toBe(1);
		await expect(
			adminDb.incomeRule.findUniqueOrThrow({ where: { id: rule.id } }),
		).resolves.toMatchObject({ matchValue: pay.id });

		await undo(b.user.id, done.value.stash);
		await expect(
			adminDb.incomeRule.findUniqueOrThrow({ where: { id: rule.id } }),
		).resolves.toMatchObject({ matchValue: gigs.id });
	});

	it("refuses the undo when the rule that moved was edited since", async () => {
		const b = await bookFor();
		const gigs = await category(b.user.id, "Gigs", { kind: "INCOME" });
		const pay = await category(b.user.id, "Pay", { kind: "INCOME" });
		const rule = await ruleFor(b.book.id, b.env.Dining as string, gigs.id);
		const done = await run(b.user.id, gigs.id, pay.id);
		await fixtureDb.incomeRule.update({
			where: { id: rule.id },
			data: { name: "Renamed since" },
		});
		await expect(undo(b.user.id, done.value.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			adminDb.incomeRule.findUniqueOrThrow({ where: { id: rule.id } }),
		).resolves.toMatchObject({ matchValue: pay.id });
	});

	it("refuses a delete while a rule names the category, so no rule silently stops matching", async () => {
		const b = await bookFor();
		const gigs = await category(b.user.id, "Gigs", { kind: "INCOME" });
		await ruleFor(b.book.id, b.env.Dining as string, gigs.id);
		await expect(run(b.user.id, gigs.id, null)).rejects.toMatchObject({
			problem: "category_income_rule",
		});
		await expect(
			fixtureDb.category.count({ where: { id: gigs.id } }),
		).resolves.toBe(1);
	});

	it("refuses a merge when a rule in a shared book the caller cannot edit names the category", async () => {
		const mine = await bookFor();
		const theirs = await bookFor();
		const gigs = await category(mine.user.id, "Gigs", { kind: "INCOME" });
		const pay = await category(mine.user.id, "Pay", { kind: "INCOME" });
		// I am a member of their book, so I can read its rules; the app edits only a personal book's.
		await adminDb.budgetMember.create({
			data: { bookId: theirs.book.id, userId: mine.user.id, role: "VIEWER" },
		});
		await ruleFor(theirs.book.id, theirs.env.Dining as string, gigs.id);

		await expect(run(mine.user.id, gigs.id, pay.id)).rejects.toMatchObject({
			problem: "category_income_rule",
		});
		await expect(
			fixtureDb.category.count({ where: { id: gigs.id } }),
		).resolves.toBe(1);
	});
});

describe("budget drafts", () => {
	it("moves the rows that name the category and the undo flips back only those", async () => {
		const b = await bookFor();
		const src = await category(b.user.id, "Cafe");
		const tgt = await category(b.user.id, "Food");
		const draft = await adminDb.budgetDraft.create({
			data: {
				id: randomUUID(),
				bookId: b.book.id,
				month: 202612,
				kind: "WHAT_IF",
				createdById: b.user.id,
				expectedIn: [
					{ id: "e1", templateId: null, categoryId: src.id, amountMinor: 100 },
					{ id: "e2", templateId: null, categoryId: tgt.id, amountMinor: 200 },
				],
				pretend: [
					{ id: "p1", kind: "OUT", categoryId: src.id, amountMinor: 50 },
				],
			},
		});

		const done = await run(b.user.id, src.id, tgt.id);
		expect(done.value.counts.draft.moved).toBe(1);
		const moved = await adminDb.budgetDraft.findUniqueOrThrow({
			where: { id: draft.id },
		});
		expect(
			(moved.expectedIn as { categoryId: string }[]).map((r) => r.categoryId),
		).toEqual([tgt.id, tgt.id]);

		await undo(b.user.id, done.value.stash);
		const back = await adminDb.budgetDraft.findUniqueOrThrow({
			where: { id: draft.id },
		});
		expect(
			(back.expectedIn as { categoryId: string }[]).map((r) => r.categoryId),
		).toEqual([src.id, tgt.id]);
		expect(
			(back.pretend as { categoryId: string }[]).map((r) => r.categoryId),
		).toEqual([src.id]);
	});
});
