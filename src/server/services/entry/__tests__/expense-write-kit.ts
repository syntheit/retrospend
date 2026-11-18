/**
 * Shared setup for the expense write characterization tests: one ARS-home
 * user (Blue ARS 1,468, Official 1,412, MEP 1,449 per USD), the three server
 * transports as one call shape, and the rows each refusal needs. Every
 * transport answers an `Out`: ok, or its status or code and message.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { expect } from "vitest";
import { entryRouter } from "~/server/api/routers/entry";
import { expenseRouter } from "~/server/api/routers/expense";
import { createCallerFactory } from "~/server/api/trpc";
import {
	asMobile,
	call,
	fixtureDb,
} from "~/server/api/v1/core/__tests__/harness";
import {
	arsUser,
	isoDay,
	openAccount,
	TODAY,
	TODAY_ZONE,
} from "~/server/services/accounts/test-fixtures";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { makeSession } from "~/test/trpc-test-utils";
import { toExpenseInput } from "../input";

export const DAY = isoDay(TODAY);

export type Fields = {
	title: string;
	amount: string;
	currency: string;
	date: string;
	categoryId?: string;
	rateType?: string;
	customRate?: string;
	location?: string;
	description?: string;
	amortizeOver?: number;
	excludeFromAnalytics?: boolean;
};

export type Refusal = {
	ok: false;
	code: string;
	message: unknown;
	status?: number;
	errors?: string[];
};
export type Out = { ok: true } | Refusal;

/** A tRPC refusal as the router answers it. */
export const trpc = (code: string, message: unknown): Refusal => ({
	ok: false,
	code,
	message,
});
/** A v1 refusal as problem+json: status, code and detail (the title when none). */
export const v1Problem = (
	status: number,
	code: string,
	message: unknown,
): Refusal => ({ ok: false, status, code, message });
export const OK: Out = { ok: true };

export const EXPENSE_NOT_FOUND = "Expense not found";
export const CATEGORY_NOT_FOUND = "Category not found";
export const LEG_MONEY =
	"This entry moved money in an account. Delete it and add it again to change its amount, currency or date.";
export const FEE_DELETE =
	"This expense moved money in an account. Undo it from its transfer.";

export interface Transport {
	readonly name: "entry" | "legacy" | "v1";
	create(id: string, f: Fields): Promise<Out>;
	update(id: string, f: Fields): Promise<Out>;
	delete(id: string): Promise<Out>;
	previewCreate?(id: string, f: Fields): Promise<Out>;
	previewUpdate?(id: string, f: Fields): Promise<Out>;
	previewDelete?(id: string): Promise<Out>;
}

async function trpcOut(run: () => Promise<unknown>): Promise<Out> {
	try {
		await run();
		return OK;
	} catch (error) {
		if (error instanceof TRPCError) return trpc(error.code, error.message);
		throw error;
	}
}

async function v1Out(res: Response): Promise<Out> {
	const text = await res.text();
	if (res.ok) return OK;
	const body = JSON.parse(text) as {
		code: string;
		title: string;
		detail?: string;
		errors?: { message: string }[];
	};
	return {
		...v1Problem(res.status, body.code, body.detail ?? body.title),
		...(body.errors ? { errors: body.errors.map((e) => e.message) } : {}),
	};
}

export interface World {
	readonly userId: string;
	readonly otherId: string;
	readonly food: string;
	readonly other: string;
	readonly holdByDefault: string;
	readonly income: string;
	readonly missing: string;
	readonly entry: Transport;
	readonly legacy: Transport;
	readonly v1: Transport;
	readonly transports: readonly Transport[];
	readonly http: Record<string, string>;
	readonly callers: ReturnType<typeof trpcCallers>;
}

const cuid = () => `c${randomUUID().replaceAll("-", "")}`;

/** The session the web sends: the user's stored zone is the process zone. */
function sessionOf(userId: string, timeZone: string) {
	const base = makeSession({ id: userId }) as unknown as { user: object };
	return { ...base, user: { ...base.user, timeZone } } as never;
}

export function trpcCallers(userId: string, db: unknown, timeZone: string) {
	const ctx = {
		session: sessionOf(userId, timeZone),
		db,
		headers: new Headers(),
	} as never;
	return {
		entry: createCallerFactory(entryRouter)(ctx),
		legacy: createCallerFactory(expenseRouter)(ctx),
	};
}

const legacyInput = (id: string, f: Fields) => ({
	id,
	title: f.title,
	amount: Number(f.amount),
	currency: f.currency,
	date: new Date(`${f.date}T00:00:00.000Z`),
	...(f.categoryId ? { categoryId: f.categoryId } : {}),
	...(f.rateType ? { rateType: f.rateType } : {}),
	...(f.customRate
		? { customRate: { base: f.currency, value: f.customRate } }
		: {}),
	...(f.location !== undefined ? { location: f.location } : {}),
	...(f.description !== undefined ? { description: f.description } : {}),
	...(f.amortizeOver ? { amortizeOver: f.amortizeOver } : {}),
	...(f.excludeFromAnalytics !== undefined
		? { excludeFromAnalytics: f.excludeFromAnalytics }
		: {}),
});

const entryInput = (id: string, f: Fields) => ({
	id,
	...f,
	categoryId: f.categoryId as string,
});

export function transportsOf(
	userId: string,
	db: unknown,
	http: Record<string, string>,
	timeZone = TODAY_ZONE,
) {
	const { entry, legacy } = trpcCallers(userId, db, timeZone);
	const send = (path: string, method: string, body?: unknown) =>
		call(path, {
			method,
			headers: http,
			...(body === undefined ? {} : { body }),
			idempotent: method !== "GET",
		}).then(v1Out);
	const entryT: Transport = {
		name: "entry",
		create: (id, f) =>
			trpcOut(() => entry.expense.create.save(entryInput(id, f))),
		update: (id, f) =>
			trpcOut(() => entry.expense.update.save(entryInput(id, f))),
		delete: (id) => trpcOut(() => entry.expense.delete.save({ id })),
		previewCreate: (id, f) =>
			trpcOut(() => entry.expense.create.preview(entryInput(id, f))),
		previewUpdate: (id, f) =>
			trpcOut(() => entry.expense.update.preview(entryInput(id, f))),
		previewDelete: (id) => trpcOut(() => entry.expense.delete.preview({ id })),
	};
	const legacyT: Transport = {
		name: "legacy",
		create: (id, f) => trpcOut(() => legacy.createExpense(legacyInput(id, f))),
		update: (id, f) => trpcOut(() => legacy.updateExpense(legacyInput(id, f))),
		delete: (id) => trpcOut(() => legacy.deleteExpense({ id })),
	};
	const v1T: Transport = {
		name: "v1",
		create: (id, f) => send("/expenses", "POST", { id, ...f }),
		update: (id, f) => send(`/expenses/${id}`, "PUT", f),
		delete: (id) => send(`/expenses/${id}`, "DELETE"),
		previewCreate: (id, f) => send("/expenses/preview", "POST", { id, ...f }),
		previewUpdate: (id, f) => send(`/expenses/${id}/preview`, "POST", f),
		previewDelete: (id) => send(`/expenses/${id}/delete/preview`, "POST"),
	};
	return { entry: entryT, legacy: legacyT, v1: v1T };
}

const category = (userId: string, extra: Record<string, unknown> = {}) =>
	fixtureDb.category.create({
		data: {
			userId,
			name: `Cat ${randomUUID().slice(0, 6)}`,
			color: "teal",
			kind: "EXPENSE",
			...extra,
		},
	});

export async function makeWorld(): Promise<World> {
	const me = await arsUser();
	const bob = await arsUser();
	const http = await asMobile(me.user.id);
	const t = transportsOf(me.user.id, me.db, http);
	return {
		userId: me.user.id,
		otherId: bob.user.id,
		food: (await category(me.user.id)).id,
		other: (await category(bob.user.id)).id,
		holdByDefault: (await category(me.user.id, { excludeByDefault: true })).id,
		income: (await category(me.user.id, { kind: "INCOME" })).id,
		missing: cuid(),
		...t,
		transports: [t.entry, t.legacy, t.v1],
		http,
		callers: trpcCallers(me.user.id, me.db, TODAY_ZONE),
	};
}

export const lunch = (w: World, extra: Partial<Fields> = {}): Fields => ({
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: DAY,
	categoryId: w.food,
	...extra,
});

/** A booked personal expense: USD 100 at Blue is ARS 146,800 unless `extra` says otherwise. */
export async function book(
	userId: string,
	f: Fields,
	id: string = randomUUID(),
	timeZone = TODAY_ZONE,
) {
	await forUser(userId).apply(
		createExpense,
		toExpenseInput({ id, ...f, categoryId: f.categoryId as string }, timeZone),
	);
	return id;
}

/** A money-in row, written straight to the table. */
export async function incomeRow(userId: string) {
	const id = randomUUID();
	await fixtureDb.expense.create({
		data: {
			id,
			userId,
			title: "Salary",
			amount: "1000",
			currency: "USD",
			date: TODAY,
			amountInUSD: "1000",
			exchangeRate: "1",
			pricingSource: "MANUAL",
			direction: "IN",
			inType: "INCOME",
		},
	});
	return id;
}

/** An expense in `categoryId` written straight to the table, whatever its kind. */
export async function rowIn(userId: string, categoryId: string) {
	const id = randomUUID();
	await fixtureDb.expense.create({
		data: {
			id,
			userId,
			title: "Old",
			amount: "100",
			currency: "USD",
			date: TODAY,
			amountInUSD: "100",
			exchangeRate: "1",
			pricingSource: "MANUAL",
			categoryId,
		},
	});
	return id;
}

/** The fee row of a transfer from Savings ARS 1,000,000 to Wallet ARS 0: ARS 1,500. */
export async function feeRow(userId: string) {
	const from = await openAccount(userId, "Savings", "CASH", "ARS", 1_000_000);
	const to = await openAccount(userId, "Wallet", "CASH", "ARS", 0);
	const { value } = await forUser(userId).apply(createTransfer, {
		fromAccountId: from,
		toAccountId: to,
		fromAmount: "1000",
		fee: { amount: "1500" },
		timeZone: TODAY_ZONE,
	});
	return value.feeExpenseId as string;
}

/** A spread parent (USD 120 over 3 months) and the ids of its parts. */
export async function spreadRow(w: World, extra: Partial<Fields> = {}) {
	const id = await book(
		w.userId,
		lunch(w, { amount: "120", amortizeOver: 3, ...extra }),
	);
	const children = await fixtureDb.expense.findMany({
		where: { parentId: id },
		select: { id: true },
		orderBy: { id: "asc" },
	});
	return { id, parts: children.map((c) => c.id) };
}

/** A shared expense the user paid, with a uuid id so every transport can name it. */
export async function sharedRow(userId: string, withId: string) {
	const me = { participantType: "user" as const, participantId: userId };
	await fixtureDb.sharedTransaction.create({
		data: {
			id: withId,
			description: "Dinner",
			amount: "100",
			currency: "ARS",
			date: TODAY,
			paidByType: "user",
			paidById: userId,
			createdByType: "user",
			createdById: userId,
			splitParticipants: {
				create: [{ ...me, shareAmount: "100", verificationStatus: "ACCEPTED" }],
			},
		},
	});
	return withId;
}

/** The whole row and its part ids: equal before and after when a write is refused. */
export const stored = (id: string) =>
	fixtureDb.expense.findUnique({
		where: { id },
		include: { children: { select: { id: true }, orderBy: { id: "asc" } } },
	});

/** Runs `run`, and expects the row to read the same afterwards. */
export async function expectUnchanged(id: string, run: () => Promise<Out>) {
	const before = await stored(id);
	const out = await run();
	expect(await stored(id)).toEqual(before);
	return out;
}
