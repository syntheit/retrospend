/**
 * Shared pieces of the recurring characterization files: an ARS user in a
 * chosen zone, a USD template at the base case, the rate table, and the two
 * transports (the web's tRPC caller and the v1 HTTP handler) on a long-lived
 * session, so a test can set the clock to any instant.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { call, MOBILE_SCOPES } from "~/server/api/v1/core/__tests__/harness";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";

export const BA = "America/Argentina/Buenos_Aires";
export const TOKYO = "Asia/Tokyo";

/** Buenos Aires midnight is 03:00Z all year. */
export const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);
export const iso = (date: Date) => date.toISOString();

/** The `updatedAt` a template starts with, far enough back that any write moves it. */
export const STAMPED = new Date("2026-11-01T00:00:00.000Z");

/** A user with ARS as home, saved in `zone`, whose preferred USD rate type is `preferred`. */
export async function arsUser(
	zone: string = BA,
	preferred: "blue" | "official" = "blue",
) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: "ARS",
			timeZone: zone,
			defaultRateTypes: { ARS: preferred },
		},
	});
	return user.id;
}

export type TemplateData =
	Partial<Prisma.RecurringTemplateUncheckedCreateInput>;

/**
 * The base case: a monthly USD 20 template on the 1st, due 2026-12-01T03:00Z
 * (the start of Dec 1 in Buenos Aires). Returns its id.
 */
export async function usdTemplate(userId: string, data: TemplateData = {}) {
	const row = await fixtureDb.recurringTemplate.create({
		data: {
			userId,
			name: "Rent",
			amount: "20",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: ba("2026-12-01"),
			anchorDay: 1,
			updatedAt: STAMPED,
			...data,
		},
	});
	return row.id;
}

/** Replaces the whole rate table (exchange_rate starts empty for each file). */
export async function setRates(
	rows: readonly (readonly [
		day: string,
		currency: string,
		type: string,
		rate: string,
	])[],
) {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({
		data: rows.map(([day, currency, type, rate]) => ({
			date: new Date(`${day}T00:00:00.000Z`),
			currency,
			type,
			rate,
		})),
	});
}

/** What a template holds that a confirm or skip can change. */
export async function templateState(id: string) {
	const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
		where: { id },
	});
	return {
		nextDueDate: iso(row.nextDueDate),
		anchorDay: row.anchorDay,
		isActive: row.isActive,
		updatedAt: iso(row.updatedAt),
		expenses: await fixtureDb.expense.count({
			where: { recurringTemplateId: id },
		}),
	};
}

/** Each expense of a user as stored, oldest first, with the home leg. */
export async function booked(userId: string) {
	const rows = await fixtureDb.expense.findMany({
		where: { userId },
		orderBy: { date: "asc" },
	});
	return rows.map((e) => ({
		title: e.title,
		date: iso(e.date),
		amount: e.amount.toString(),
		currency: e.currency,
		usd: e.amountInUSD.toString(),
		rate: e.exchangeRate.toString(),
		rateType: e.rateType,
		homeCurrency: e.homeCurrency,
		homeRate: e.homeRate?.toString(),
		home: e.homeAmount?.toString(),
		pricingSource: e.pricingSource,
		status: e.status,
		direction: e.direction,
		inType: e.inType,
		categoryId: e.categoryId,
		excludeFromAnalytics: e.excludeFromAnalytics,
		recurringTemplateId: e.recurringTemplateId,
	}));
}

const createCaller = createCallerFactory(appRouter);

/** The web's tRPC caller on a real session, sending the browser's zone header. */
export async function trpcFor(userId: string, requestZone?: string) {
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
	});
	if (requestZone) headers.set("x-timezone", requestZone);
	return createCaller(await createTRPCContext({ headers }));
}

/** A v1 client on the mobile app's session (every scope), sending a zone header when given. */
export async function v1For(userId: string, requestZone?: string) {
	const token = randomBytes(24).toString("hex");
	await adminDb.session.create({
		data: {
			id: randomUUID(),
			token,
			userId,
			expiresAt: new Date("2100-01-01T00:00:00Z"),
			scopes: MOBILE_SCOPES,
			clientId: "retrospend-mobile",
		},
	});
	const headers: Record<string, string> = {
		authorization: `Bearer ${token}`,
	};
	if (requestZone) headers["x-timezone"] = requestZone;
	return (method: string, path: string, body?: unknown) =>
		call(path, { method, headers, body, idempotent: true });
}

export type V1 = Awaited<ReturnType<typeof v1For>>;
