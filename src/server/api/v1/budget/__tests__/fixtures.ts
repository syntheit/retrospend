/**
 * Shared pieces of the G4 budget pg tests: the apiV1 and envelopeBudget flags
 * on for the file, a USD user with a Flex book set up through the web's own
 * mutation, and small readers for the month.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import { adminDb } from "~/test/pg-harness";
import { asMobile as sessionHeaders } from "../../core/__tests__/harness";

export const usd = (minor: number) => ({ minor, currency: "USD" });

/** apiV1 and the envelope budget on for a file; both go back afterwards. */
export function useBudgetV1() {
	let before = { api: "OFF", budget: "OFF" } as Record<string, string>;
	beforeAll(async () => {
		await getAppSettings();
		const settings = await adminDb.appSettings.findUniqueOrThrow({
			where: { id: "app_settings_singleton" },
		});
		before = {
			api: settings.apiV1Mode,
			budget: settings.envelopeBudgetMode,
		};
		await adminDb.appSettings.update({
			where: { id: "app_settings_singleton" },
			data: { apiV1Mode: "ALL", envelopeBudgetMode: "ALL" },
		});
		await updateAppSettings({});
	});
	afterAll(async () => {
		await adminDb.appSettings.update({
			where: { id: "app_settings_singleton" },
			data: {
				apiV1Mode: before.api as "OFF",
				envelopeBudgetMode: before.budget as "OFF",
			},
		});
		await updateAppSettings({});
	});
}

export async function setBudgetFlag(mode: "ALL" | "OFF") {
	await adminDb.appSettings.update({
		where: { id: "app_settings_singleton" },
		data: { envelopeBudgetMode: mode },
	});
	await updateAppSettings({});
}

/** A USD user with Rent, Dining and a Flex book (USD 1,000 to start, Rent 500 and Dining 200 targets). */
export async function bookedUser() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const envelopes = await adminDb.envelope.findMany({
		where: { book: { createdById: s.user.id } },
	});
	const ids = Object.fromEntries(
		envelopes.map((e) => [e.name, e.id]),
	) as Record<string, string>;
	return { ...s, ids };
}

/** What differs between a dry run and the real write: clocks and ids the database makes. */
const VOLATILE = new Set([
	"createdAt",
	"updatedAt",
	"appliedAt",
	"periodId",
	"bookId",
	"interestExpenseId",
	"wealthTransferId",
]);

/** A body without the volatile fields, so a preview's answer can equal a write's. */
export function withoutStamps<T>(value: T): T {
	return JSON.parse(
		JSON.stringify(value, (key, v) => (VOLATILE.has(key) ? undefined : v)),
	) as T;
}

export const uuid = () => randomUUID();

const minorText = (n: number) => {
	if (!Number.isInteger(n)) return String(n / 100);
	const abs = Math.abs(n);
	const frac = String(abs % 100).padStart(2, "0");
	return `${n < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${frac}`;
};

/**
 * The engine's request bodies in the form v1 takes: every \`<name>Minor\` number
 * is \`<name>\` text in USD (all of these tests are USD books).
 */
export function toV1<T>(value: T): T {
	const walk = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(walk);
		if (v === null || typeof v !== "object") return v;
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>).map(([k, x]) =>
				k.endsWith("Minor") && typeof x === "number"
					? [k.slice(0, -5), minorText(x)]
					: [k, walk(x)],
			),
		);
	};
	return walk(value) as T;
}

/** A movement answer without the ids and order the engine makes for each run. */
export function movementShape(result: unknown): unknown {
	const r = result as {
		movements?: {
			id?: string;
			createdAt?: string;
			amount: { minor: number };
		}[];
		envelopes?: { id: string; after: { minor: number } }[];
		toAssign?: unknown;
	};
	const rows = (r.movements ?? [])
		.map(({ id: _id, createdAt: _at, ...rest }) => rest)
		.sort((a, b) => a.amount.minor - b.amount.minor);
	return {
		movements: rows,
		envelopes: [...(r.envelopes ?? [])].sort(
			(a, b) => a.after.minor - b.after.minor,
		),
		toAssign: r.toAssign,
	};
}

/**
 * Mobile headers from an address of the file's own: these files send hundreds
 * of requests a minute, and the per-IP limit is shared by every v1 test file.
 */
export const mobileFrom = (ip: string) => async (userId: string) => ({
	...(await sessionHeaders(userId)),
	"x-forwarded-for": ip,
});
