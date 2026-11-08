/**
 * Every write path for user free text validates through userText (E2EE lane
 * D4b): a C0 control character is refused, ordinary text with line feeds and
 * tabs is kept as typed, and a field that took "" before still takes it.
 * Procedures are read through their declared input, so no resolver runs.
 */
import {
	createAccessTokenSchema,
	updateProfileSchema,
	USER_TEXT_FIELDS,
} from "@retrospend/api-contract";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));
vi.mock("~/server/db", () => ({ db: {}, createUserScopedDb: vi.fn() }));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn(() => null) }));

import { setupInputSchema } from "~/lib/schemas/envelope";
import {
	addIncomeSchema,
	createAccountSchema,
	createTransferSchema,
	recreateIncomeSchema,
	recreateTransferSchema,
} from "~/server/services/accounts/input";
import {
	expenseFormSchema,
	expenseRestoreSchema,
	sharedCreateSchema,
	sharedRestoreSchema,
	sharedUpdateSchema,
} from "~/server/services/entry/input";
import { recordPaymentSchema } from "~/server/services/payments/input";
import { projectInput } from "~/server/services/project/inputs";
import { billingPeriodRouter } from "../routers/billingPeriod";
import { expenseRouter } from "../routers/expense";
import { feedbackRouter } from "../routers/feedback";
import { guestRouter } from "../routers/guest";
import { paymentMethodRouter } from "../routers/paymentMethod";
import { peopleRouter } from "../routers/people";
import { recurringRouter } from "../routers/recurring";
import { settlementRouter } from "../routers/settlement";
import { sharedTransactionRouter } from "../routers/shared-transaction";
import { userRouter } from "../routers/user";
import { verificationRouter } from "../routers/verification";

type Procedures = Record<string, { _def: { inputs: unknown[] } } | undefined>;

/** The declared input of one procedure. */
function inputOf(
	router: { _def: { procedures: unknown } },
	name: string,
): z.ZodType {
	const procedure = (router._def.procedures as Procedures)[name];
	const schema = procedure?._def.inputs[0];
	if (!schema) throw new Error(`${name} has no input`);
	return schema as z.ZodType;
}

function withField(base: object, path: string, value: unknown): unknown {
	const copy = structuredClone(base) as Record<string, unknown>;
	const keys = path.split(".");
	let node: Record<string, unknown> = copy;
	for (const key of keys.slice(0, -1))
		node = node[key] as Record<string, unknown>;
	node[keys[keys.length - 1] ?? ""] = value;
	return copy;
}

const person = { participantType: "user", participantId: "u1" } as const;
const split = {
	paidBy: person,
	splitWith: [person],
	splitMode: "EQUAL",
} as const;

type Case = {
	label: string;
	schema: z.ZodType;
	base: object;
	/** Dotted path of the text field in the input. */
	path: string;
	/** True when the route took "" before this change. */
	empty?: boolean;
};

const cid = "ckxxxxxxxxxxxxxxxxxxxxxxx";
const uuid = "6f1c2f3a-1b2c-4d5e-8f90-123456789abc";

const cases: Case[] = [
	{
		label: "expense.create title",
		schema: inputOf(expenseRouter, "createExpense"),
		base: { id: uuid, title: "Lunch", amount: 5, date: new Date() },
		path: "title",
	},
	{
		label: "expense.create description",
		schema: inputOf(expenseRouter, "createExpense"),
		base: { id: uuid, title: "Lunch", amount: 5, date: new Date() },
		path: "description",
		empty: true,
	},
	{
		label: "expense.importExpenses row location",
		schema: inputOf(expenseRouter, "importExpenses"),
		base: {
			rows: [{ title: "Lunch", amount: 5, currency: "USD", date: new Date() }],
		},
		path: "rows.0.location",
		empty: true,
	},
	{
		label: "sharedTransaction.update notes",
		schema: inputOf(sharedTransactionRouter, "update"),
		base: { id: "t1" },
		path: "notes",
		empty: true,
	},
	{
		label: "sharedTransaction.update description",
		schema: inputOf(sharedTransactionRouter, "update"),
		base: { id: "t1" },
		path: "description",
	},
	{
		label: "people.createShadow name",
		schema: inputOf(peopleRouter, "createShadow"),
		base: { name: "Dana" },
		path: "name",
	},
	{
		label: "recurring.create name",
		schema: inputOf(recurringRouter, "create"),
		base: {
			name: "Rent",
			amount: 5,
			frequency: "MONTHLY",
			nextDueDate: new Date(),
		},
		path: "name",
	},
	{
		label: "recurring.update paymentSource",
		schema: inputOf(recurringRouter, "update"),
		base: { id: cid },
		path: "paymentSource",
	},
	{
		label: "settlement.create note",
		schema: inputOf(settlementRouter, "create"),
		base: { toParticipant: person, amount: 5, currency: "USD" },
		path: "note",
		empty: true,
	},
	{
		label: "settlement.reject reason",
		schema: inputOf(settlementRouter, "reject"),
		base: { id: "p1" },
		path: "reason",
		empty: true,
	},
	{
		label: "verification.reject reason",
		schema: inputOf(verificationRouter, "reject"),
		base: { txnId: "t1" },
		path: "reason",
		empty: true,
	},
	{
		label: "billingPeriod.updateLabel label",
		schema: inputOf(billingPeriodRouter, "updateLabel"),
		base: { projectId: "p1", periodId: "b1", label: "May" },
		path: "label",
	},
	{
		label: "guest.register name",
		schema: inputOf(guestRouter, "register"),
		base: { linkId: "l1", name: "Guest", email: "guest@example.com" },
		path: "name",
	},
	{
		label: "paymentMethod label",
		schema: inputOf(paymentMethodRouter, "upsert"),
		base: {
			methods: [{ type: "bank", rank: 1, visibility: "PUBLIC", label: "Main" }],
		},
		path: "methods.0.label",
		empty: true,
	},
	{
		label: "feedback.submit message",
		schema: inputOf(feedbackRouter, "submit"),
		base: { message: "Hi", pageUrl: "/" },
		path: "message",
	},
	{
		label: "feedback.addNote note",
		schema: inputOf(feedbackRouter, "addNote"),
		base: { id: "f1", note: "ok" },
		path: "note",
		empty: true,
	},
	{
		label: "user.updateProfile name",
		schema: inputOf(userRouter, "updateProfile"),
		base: { name: "Dana", username: "dana", email: "dana@example.com" },
		path: "name",
	},
	{
		label: "recordPayment note",
		schema: recordPaymentSchema,
		base: { person, direction: "outgoing", currency: "USD", amount: null },
		path: "note",
		empty: true,
	},
	{
		label: "recordPayment paymentMethod",
		schema: recordPaymentSchema,
		base: { person, direction: "outgoing", currency: "USD", amount: null },
		path: "paymentMethod",
		empty: true,
	},
	{
		label: "expenseForm title",
		schema: expenseFormSchema,
		base: {
			id: "e1",
			title: "Lunch",
			amount: "5",
			currency: "USD",
			date: "2026-11-01",
			categoryId: cid,
		},
		path: "title",
	},
	{
		label: "expenseForm location",
		schema: expenseFormSchema,
		base: {
			id: "e1",
			title: "Lunch",
			amount: "5",
			currency: "USD",
			date: "2026-11-01",
			categoryId: cid,
		},
		path: "location",
		empty: true,
	},
	{
		label: "sharedCreate notes",
		schema: sharedCreateSchema,
		base: {
			amount: "5",
			currency: "USD",
			description: "Dinner",
			date: "2026-11-01",
			...split,
		},
		path: "notes",
		empty: true,
	},
	{
		label: "sharedUpdate description",
		schema: sharedUpdateSchema,
		base: {
			id: "t1",
			amount: "5",
			currency: "USD",
			description: "Dinner",
			date: "2026-11-01",
			notes: null,
			projectId: null,
			...split,
		},
		path: "description",
	},
	{
		label: "createAccount name",
		schema: createAccountSchema,
		base: { name: "Cash", type: "CASH", currency: "ARS", balance: 1 },
		path: "name",
	},
	{
		label: "createTransfer note",
		schema: createTransferSchema,
		base: {
			fromAccountId: "a1",
			toAccountId: "a2",
			fromAmount: "5",
		},
		path: "note",
		empty: true,
	},
	{
		label: "addIncome title",
		schema: addIncomeSchema,
		base: { title: "Pay", amount: "5", currency: "ARS" },
		path: "title",
	},
	{
		label: "project create name",
		schema: projectInput.create,
		base: { name: "Trip" },
		path: "name",
	},
	{
		label: "project update description",
		schema: projectInput.update,
		base: { id: "p1" },
		path: "description",
		empty: true,
	},
	{
		label: "api token name",
		schema: createAccessTokenSchema,
		base: { name: "CLI", scopes: ["read"] },
		path: "name",
	},
	{
		label: "budget setup envelope name",
		schema: setupInputSchema,
		base: {
			style: "FLEX",
			groups: [],
			envelopes: [
				{
					key: "k1",
					name: "Rent",
					groupKey: null,
					kind: "NONE",
					isDefault: true,
				},
			],
		},
		path: "envelopes.0.name",
	},
];

describe.each(cases)("$label", ({ schema, base, path, empty }) => {
	it("takes the base input", () => {
		const result = schema.safeParse(base);
		expect(result.error?.issues).toBeUndefined();
	});

	it("refuses a control character", () => {
		for (const text of ["bell\u0007", "nul\u0000", "marker\u0001k1:AAAA"])
			expect(
				schema.safeParse(withField(base, path, text)).success,
				JSON.stringify(text),
			).toBe(false);
	});

	it("refuses a lone surrogate", () => {
		expect(schema.safeParse(withField(base, path, "a\uD800")).success).toBe(
			false,
		);
	});

	it("keeps line feeds, tabs and emoji as typed", () => {
		const text = "Line one\r\nLine two\ttabbed \u{1F355}";
		const result = schema.safeParse(withField(base, path, text));
		expect(result.error?.issues).toBeUndefined();
		const out = path
			.split(".")
			.reduce<unknown>(
				(node, key) => (node as Record<string, unknown>)[key],
				result.data,
			);
		expect(out).toBe(text);
	});

	it(
		empty ? "still takes an empty string" : "still refuses an empty string",
		() => {
			expect(schema.safeParse(withField(base, path, "")).success).toBe(
				Boolean(empty),
			);
		},
	);
});

describe("trimmed names", () => {
	it("keeps trimming a display name and a token name", () => {
		expect(
			createAccessTokenSchema.parse({ name: "  CLI  ", scopes: ["read"] }).name,
		).toBe("CLI");
		expect(
			updateProfileSchema.parse({
				name: " Dana ",
				username: "dana",
				email: "dana@example.com",
			}).name,
		).toBe("Dana");
	});

	it("still refuses a blank one", () => {
		expect(
			createAccessTokenSchema.safeParse({ name: "   ", scopes: ["read"] })
				.success,
		).toBe(false);
	});
});

describe("restore payloads", () => {
	it("accept any text the column holds, control characters included", () => {
		const stored = "legacy\u000bimport\u0001";
		expect(
			expenseRestoreSchema.safeParse({
				id: "e1",
				title: stored,
				amount: 5,
				currency: "USD",
				date: new Date(),
				location: stored,
				description: stored,
			}).success,
		).toBe(true);
		expect(
			sharedRestoreSchema.safeParse({
				id: "t1",
				amount: 5,
				currency: "USD",
				description: stored,
				categoryId: null,
				date: new Date(),
				notes: stored,
				projectId: null,
				...split,
			}).success,
		).toBe(true);
	});

	it("accept a stored control character when an income or a move comes back", () => {
		const stored = "legacy\u000bimport\u0001";
		expect(
			recreateTransferSchema.safeParse({
				id: "m1",
				fromAccountId: "a1",
				toAccountId: "a2",
				fromAmount: "5",
				note: stored,
			}).success,
		).toBe(true);
		expect(
			recreateIncomeSchema.safeParse({
				id: "i1",
				title: stored,
				amount: "5",
				currency: "ARS",
				description: stored,
			}).success,
		).toBe(true);
	});
});

describe("declared fields", () => {
	it("registers the fields this change declared", () => {
		for (const field of ["user.name", "guest_session.name", "apikey.name"])
			expect(USER_TEXT_FIELDS.has(field), field).toBe(true);
	});
});
