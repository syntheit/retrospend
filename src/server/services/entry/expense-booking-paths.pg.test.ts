/**
 * Both server create paths book the same row from the same body: the web's
 * tRPC entry.expense.create and v1 POST /expenses, each from a request that
 * carries a zone (the browser's header, x-timezone) and from one that does
 * not (the saved zone applies). The user's saved zone is UTC; the request
 * zone is Buenos Aires. The cases, their hand-derived booked values and the
 * instant of each day in each zone are in
 * packages/domain/vectors/expense-input.vectors.json, the same file the
 * domain's mapping test and the device engine run.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { dec } from "@retrospend/domain/precise-decimal";
import vectors from "@retrospend/domain/vectors/expense-input.vectors.json";
import { makeSignature } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import {
	asMobile,
	call,
	expectBody,
} from "~/server/api/v1/core/__tests__/harness";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const createCaller = createCallerFactory(appRouter);
const rateDate = new Date(vectors.rateDate);

beforeAll(async () => {
	await adminDb.exchangeRate.createMany({
		data: vectors.rates.map((r) => ({ ...r, date: rateDate })),
	});
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({ where: { date: rateDate } });
});

type Case = (typeof vectors.cases)[number];

/** A user with the case's home currency and a saved zone of UTC, plus a category. */
async function userFor(c: Case) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: c.homeCurrency, timeZone: "UTC" },
	});
	const category = await fixtureDb.category.create({
		data: { userId: user.id, name: "Travel", color: "teal", kind: "EXPENSE" },
	});
	return { userId: user.id, categoryId: category.id };
}

/** A tRPC caller on a real session, sending the browser's zone header when it has one. */
async function trpcFor(userId: string, requestZone?: string) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date("2100-01-01T00:00:00Z"),
		},
	});
	const signature = await makeSignature(token, env.BETTER_AUTH_SECRET ?? "");
	const headers = new Headers({
		cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
		...(requestZone ? { "x-timezone": requestZone } : {}),
	});
	return createCaller(await createTRPCContext({ headers }));
}

async function createViaTrpc(
	c: Case,
	userId: string,
	categoryId: string,
	requestZone?: string,
) {
	const id = randomUUID();
	const caller = await trpcFor(userId, requestZone);
	await caller.entry.expense.create.save({ ...c.body, id, categoryId });
	return id;
}

async function createViaV1(
	c: Case,
	userId: string,
	categoryId: string,
	requestZone?: string,
) {
	const id = randomUUID();
	const headers = {
		...(await asMobile(userId)),
		...(requestZone ? { "x-timezone": requestZone } : {}),
	};
	await expectBody(
		await call("/expenses", {
			method: "POST",
			headers,
			body: { ...c.body, id, categoryId },
			idempotent: true,
		}),
		contract.expenses.create,
		201,
	);
	return id;
}

const paths = [
	["tRPC entry.expense.create", createViaTrpc],
	["v1 POST /expenses", createViaV1],
] as const;

const zones = [
	["a Buenos Aires request", BUENOS_AIRES],
	["a request with no zone, so the saved UTC", undefined],
] as const;

const same = (actual: unknown, expected: string, what: string) =>
	expect(dec(String(actual)).eq(dec(expected)), `${what}: ${actual}`).toBe(
		true,
	);

describe.each(vectors.cases)("$name", (c) => {
	let who: { userId: string; categoryId: string };
	beforeAll(async () => {
		who = await userFor(c);
	});

	describe.each(paths)("%s", (_path, create) => {
		it.each(zones)("from %s books the vector's row", async (_zone, zone) => {
			const id = await create(c, who.userId, who.categoryId, zone);
			const row = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
			const b = c.booked;
			const instants = c.instants as Record<string, string>;

			expect(row.date.toISOString()).toBe(instants[zone ?? "UTC"]);
			expect(row.currency).toBe(b.currency);
			expect(row.homeCurrency).toBe(b.homeCurrency);
			expect(row.rateType).toBe(b.rateType);
			same(row.amount, b.amount, "amount");
			same(row.exchangeRate, b.exchangeRate, "exchangeRate");
			same(row.amountInUSD, b.amountInUSD, "amountInUSD");
			same(row.homeRate, b.homeRate, "homeRate");
			same(row.homeAmount, b.homeAmount, "homeAmount");
			expect(row.pricingSource).toBe("MANUAL");
			expect(row.status).toBe("FINALIZED");
			expect(row.direction).toBe("OUT");
		});
	});
});
