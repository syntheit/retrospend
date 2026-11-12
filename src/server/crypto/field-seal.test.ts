import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Keyring, openField } from "./field-crypto";
import { applySeal, planSeal } from "./field-seal";
import { buildModelGraph } from "./model-graph";

const rel = (name: string, type: string) => ({ name, kind: "object", type });
const graph = buildModelGraph({
	models: {
		SharedTransaction: {
			fields: [rel("splitParticipants", "SplitParticipant")],
		},
		SplitParticipant: { fields: [rel("transaction", "SharedTransaction")] },
		Project: { fields: [rel("billingPeriods", "BillingPeriod")] },
		BillingPeriod: { fields: [rel("project", "Project")] },
		Category: { fields: [rel("user", "User")] },
		Expense: { fields: [rel("user", "User")] },
		Payment: { fields: [] },
		IdempotencyKey: { fields: [rel("user", "User")] },
		ImportJob: { fields: [rel("user", "User")] },
		Feedback: { fields: [rel("user", "User")] },
		User: { fields: [rel("categories", "Category")] },
	},
});

const ring = new Keyring([{ id: 1, key: randomBytes(32) }]);
const ALICE = "user-alice";

type Row = Record<string, unknown>;
const sealedIn = (
	args: Row,
	model: string,
	operation: string,
	userId = ALICE,
) => {
	const plan = planSeal(graph, userId, model, operation, args);
	applySeal(plan.cells, () => ring);
	return plan.args;
};
const open = (value: unknown, table: string, column: string, rowId: unknown) =>
	openField(ring, value as string, { table, column, rowId: rowId as string });
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		return (error as { code?: string }).code;
	}
	return "none";
};

describe("planSeal and applySeal", () => {
	it("seals a create under a new cuid id and keeps a given id, never changing the caller's args", () => {
		const args = { data: { description: "Dinner", notes: null } };
		const out = sealedIn(args, "SharedTransaction", "create").data as Row;
		expect(z.cuid().safeParse(out.id).success).toBe(true);
		expect(
			open(out.description, "shared_transaction", "description", out.id),
		).toBe("Dinner");
		expect(out.notes).toBeNull();
		expect(args).toEqual({ data: { description: "Dinner", notes: null } });

		const given = sealedIn(
			{ data: { id: "uuid-1", description: "" } },
			"SharedTransaction",
			"create",
		).data as Row;
		expect(given.id).toBe("uuid-1");
		expect(
			open(given.description, "shared_transaction", "description", "uuid-1"),
		).toBe("");
	});

	it("gives ids only to createMany rows that carry text", () => {
		const out = sealedIn(
			{ data: [{ description: "A" }, { amount: 1 }] },
			"SharedTransaction",
			"createMany",
		).data as Row[];
		expect(
			open(
				out[0]?.description,
				"shared_transaction",
				"description",
				out[0]?.id,
			),
		).toBe("A");
		expect(out[1]).toEqual({ amount: 1 });
	});

	it("refuses a create of a model whose callers name the id, when it names none", () => {
		expect(
			code(() =>
				planSeal(graph, ALICE, "Payment", "create", { data: { note: "x" } }),
			),
		).toBe("missing_row_id");
	});

	it("seals user text only for the client's own user", () => {
		const own = sealedIn(
			{ data: { userId: ALICE, title: "Rent" } },
			"Expense",
			"create",
		).data as Row;
		expect(open(own.title, "expense", "title", own.id)).toBe("Rent");
		const connected = sealedIn(
			{ data: { user: { connect: { id: ALICE } }, title: "Gas" } },
			"Expense",
			"create",
		).data as Row;
		expect(open(connected.title, "expense", "title", connected.id)).toBe("Gas");
		expect(
			code(() =>
				planSeal(graph, ALICE, "Expense", "create", {
					data: { userId: "bob", title: "x" },
				}),
			),
		).toBe("foreign_owner");
		expect(
			code(() =>
				planSeal(graph, undefined, "Expense", "create", {
					data: { userId: ALICE, title: "x" },
				}),
			),
		).toBe("foreign_owner");
		expect(
			code(() =>
				planSeal(graph, undefined, "Expense", "update", {
					where: { id: "e1" },
					data: { title: "x" },
				}),
			),
		).toBe("foreign_owner");
		// A write with no user text needs no owner.
		expect(
			planSeal(graph, undefined, "Expense", "create", { data: { amount: 1 } })
				.cells,
		).toEqual([]);
	});

	it("binds an update to where.id and keeps the { set } form", () => {
		const out = sealedIn(
			{ where: { id: "s1", userId: ALICE }, data: { notes: { set: "wine" } } },
			"SharedTransaction",
			"update",
		).data as Row;
		expect(
			open((out.notes as Row).set, "shared_transaction", "notes", "s1"),
		).toBe("wine");
		expect(
			code(() =>
				planSeal(graph, ALICE, "SharedTransaction", "update", {
					where: { description: "x" },
					data: { notes: "y" },
				}),
			),
		).toBe("missing_row_id");
		expect(
			planSeal(graph, ALICE, "SharedTransaction", "update", {
				where: { amount: 1 },
				data: { notes: null },
			}).cells,
		).toEqual([]);
	});

	it("binds an upsert's create half to its own id, else the where's, written into the data", () => {
		const out = sealedIn(
			{
				where: { id: "s1" },
				create: { description: "A" },
				update: { notes: "B" },
			},
			"SharedTransaction",
			"upsert",
		);
		expect((out.create as Row).id).toBe("s1");
		expect(
			open(
				(out.create as Row).description,
				"shared_transaction",
				"description",
				"s1",
			),
		).toBe("A");
		expect(
			open((out.update as Row).notes, "shared_transaction", "notes", "s1"),
		).toBe("B");
		const own = sealedIn(
			{
				where: { id: "s1" },
				create: { id: "s2", description: "A" },
				update: {},
			},
			"SharedTransaction",
			"upsert",
		);
		expect(
			open(
				(own.create as Row).description,
				"shared_transaction",
				"description",
				"s2",
			),
		).toBe("A");
	});

	it("refuses a bulk write that sets text and lets a null through", () => {
		expect(
			code(() =>
				planSeal(graph, ALICE, "SplitParticipant", "updateMany", {
					where: {},
					data: { rejectionReason: "no" },
				}),
			),
		).toBe("bulk_text_write");
		expect(
			code(() =>
				planSeal(graph, ALICE, "SplitParticipant", "updateManyAndReturn", {
					where: {},
					data: { rejectionReason: { set: "" } },
				}),
			),
		).toBe("bulk_text_write");
		expect(
			planSeal(graph, ALICE, "SplitParticipant", "updateMany", {
				where: {},
				data: { rejectionReason: null },
			}).cells,
		).toEqual([]);
	});

	it("refuses a value that already looks sealed", () => {
		expect(
			code(() =>
				planSeal(graph, ALICE, "SharedTransaction", "create", {
					data: { description: "\u0001k1:AAAA" },
				}),
			),
		).toBe("bad_plaintext");
	});

	it("seals nested creates, createMany, connectOrCreate, upsert and update with an id", () => {
		const out = sealedIn(
			{
				where: { id: "p1" },
				data: {
					name: "Trip",
					billingPeriods: {
						create: [{ label: "Nov" }],
						createMany: { data: { label: "Dec" } },
						connectOrCreate: { where: { id: "b9" }, create: { label: "Jan" } },
						upsert: {
							where: { id: "b2" },
							create: { label: "Feb" },
							update: { label: "Mar" },
						},
						update: { where: { id: "b3" }, data: { label: "Apr" } },
						delete: { id: "b4" },
					},
				},
			},
			"Project",
			"update",
		);
		const data = out.data as Row;
		expect(open(data.name, "project", "name", "p1")).toBe("Trip");
		const nested = data.billingPeriods as Record<string, Row & Row[]>;
		const label = (row: unknown) =>
			open((row as Row).label, "billing_period", "label", (row as Row).id);
		expect(label(nested.create?.[0])).toBe("Nov");
		expect(label((nested.createMany as Row).data)).toBe("Dec");
		expect(label((nested.connectOrCreate as Row).create)).toBe("Jan");
		expect(label((nested.upsert as Row).create)).toBe("Feb");
		expect(((nested.upsert as Row).create as Row).id).toBe("b2");
		expect(
			open(
				((nested.upsert as Row).update as Row).label,
				"billing_period",
				"label",
				"b2",
			),
		).toBe("Mar");
		expect(
			open(
				((nested.update as Row).data as Row).label,
				"billing_period",
				"label",
				"b3",
			),
		).toBe("Apr");
		expect(nested.delete).toEqual({ id: "b4" });
	});

	it("refuses nested text it cannot bind to a row", () => {
		const nestedUpdate = (ops: Row) => () =>
			planSeal(graph, ALICE, "BillingPeriod", "update", {
				where: { id: "b1" },
				data: { project: ops },
			});
		expect(code(nestedUpdate({ update: { name: "x" } }))).toBe(
			"unsealable_nested",
		);
		expect(code(nestedUpdate({ update: { data: { name: "x" } } }))).toBe(
			"unsealable_nested",
		);
		expect(
			code(
				nestedUpdate({
					upsert: { create: { name: "x" }, update: { name: "y" } },
				}),
			),
		).toBe("unsealable_nested");
		expect(
			code(() =>
				planSeal(graph, ALICE, "Project", "update", {
					where: { id: "p1" },
					data: {
						billingPeriods: { updateMany: { where: {}, data: { label: "x" } } },
					},
				}),
			),
		).toBe("bulk_text_write");
		// A nested user-class create must name its owner too.
		expect(
			code(() =>
				planSeal(graph, ALICE, "User", "update", {
					where: { id: ALICE },
					data: { categories: { create: { name: "Food", nameIndex: "i" } } },
				}),
			),
		).toBe("foreign_owner");
	});

	it("seals a category name only beside its name index, and leaves a class with no ring plaintext", () => {
		const plan = planSeal(graph, ALICE, "Category", "create", {
			data: { userId: ALICE, name: "Food" },
		});
		expect(code(() => applySeal(plan.cells, () => ring))).toBe(
			"category_index_missing",
		);
		applySeal(plan.cells, () => undefined);
		expect((plan.args.data as Row).name).toBe("Food");
		const indexed = sealedIn(
			{
				where: { id: "c1" },
				data: { name: "Fuel", nameIndex: { set: "t:h" } },
			},
			"Category",
			"update",
		).data as Row;
		expect(open(indexed.name, "category", "name", "c1")).toBe("Fuel");
	});
});

describe("a JSON body cell", () => {
	const body = { result: { id: "a1", name: "Caja fuerte" } };
	const openBody = (stored: unknown, rowId: unknown) =>
		JSON.parse(
			open(
				(stored as { sealed: string }).sealed,
				"idempotency_key",
				"responseBody",
				rowId,
			),
		);

	it("seals a create under its new id and an update under where.id, leaving the caller's args", () => {
		const args = { data: { userId: ALICE, key: "k", responseBody: body } };
		const made = sealedIn(args, "IdempotencyKey", "create").data as Row;
		expect(z.cuid().safeParse(made.id).success).toBe(true);
		expect(made.key).toBe("k");
		expect(openBody(made.responseBody, made.id)).toEqual(body);
		expect(args.data.responseBody).toBe(body);

		const updated = sealedIn(
			{ where: { id: "k1" }, data: { status: 200, responseBody: body } },
			"IdempotencyKey",
			"update",
		).data as Row;
		expect(openBody(updated.responseBody, "k1")).toEqual(body);
	});

	it("seals nothing for a null or a Prisma null marker", () => {
		class DbNull {}
		const marker = new DbNull();
		for (const responseBody of [null, marker]) {
			const plan = planSeal(graph, ALICE, "IdempotencyKey", "update", {
				where: { id: "k1" },
				data: { responseBody },
			});
			expect(plan.cells).toEqual([]);
		}
	});

	it("refuses a bulk write, an update with no id and a client with no user", () => {
		const data = { responseBody: body };
		expect(
			code(() =>
				planSeal(graph, ALICE, "IdempotencyKey", "updateMany", {
					where: { id: "k1" },
					data,
				}),
			),
		).toBe("bulk_text_write");
		expect(
			code(() =>
				planSeal(graph, ALICE, "IdempotencyKey", "update", {
					where: { userId_key: { userId: ALICE, key: "k" } },
					data,
				}),
			),
		).toBe("missing_row_id");
		expect(
			code(() =>
				planSeal(graph, undefined, "IdempotencyKey", "create", {
					data: { userId: ALICE, ...data },
				}),
			),
		).toBe("foreign_owner");
	});
});

describe("an import job's and a feedback entry's JSON cells", () => {
	const rows = [{ title: "Farmacia del Pueblo", amount: 12500 }];
	const warnings = ['Row 3: Invalid date "ayer-mismo", skipping'];
	const openAt = (stored: unknown, table: string, column: string, id: string) =>
		JSON.parse(open((stored as { sealed: string }).sealed, table, column, id));

	it("seals rows and warnings each under its own column, on the owner's key", () => {
		const made = sealedIn(
			{ data: { userId: ALICE, transactions: rows, warnings } },
			"ImportJob",
			"create",
		).data as Row;
		const id = made.id as string;
		expect(openAt(made.transactions, "import_job", "transactions", id)).toEqual(
			rows,
		);
		expect(openAt(made.warnings, "import_job", "warnings", id)).toEqual(
			warnings,
		);
		// A body cannot be read back under the other column's name.
		expect(() =>
			openAt(made.warnings, "import_job", "transactions", id),
		).toThrow();
	});

	it("seals an update by id, leaves an undefined warnings alone, and refuses a bulk set", () => {
		const updated = sealedIn(
			{
				where: { id: "j1" },
				data: {
					status: "READY_FOR_REVIEW",
					transactions: rows,
					warnings: undefined,
				},
			},
			"ImportJob",
			"update",
		).data as Row;
		expect(
			openAt(updated.transactions, "import_job", "transactions", "j1"),
		).toEqual(rows);
		expect(updated.warnings).toBeUndefined();
		expect(
			code(() =>
				planSeal(graph, ALICE, "ImportJob", "updateMany", {
					where: { id: "j1" },
					data: { warnings },
				}),
			),
		).toBe("bulk_text_write");
		// A claim that sets no JSON cell stays a bulk write.
		expect(
			planSeal(graph, ALICE, "ImportJob", "updateMany", {
				where: { id: "j1", status: "READY_FOR_REVIEW" },
				data: { status: "COMPLETED" },
			}).cells,
		).toEqual([]);
	});

	it("refuses another user's import rows, and seals diagnostics for any client", () => {
		expect(
			code(() =>
				planSeal(graph, undefined, "ImportJob", "create", {
					data: { userId: ALICE, transactions: rows },
				}),
			),
		).toBe("foreign_owner");
		const diagnostics = { os: "Android 15", device: "Pixel 8" };
		const plan = planSeal(graph, undefined, "Feedback", "create", {
			data: { userId: ALICE, message: "Hola", diagnostics },
		});
		applySeal(plan.cells, () => ring);
		const made = plan.args.data as Row;
		expect(
			openAt(made.diagnostics, "feedback", "diagnostics", made.id as string),
		).toEqual(diagnostics);
	});
});
