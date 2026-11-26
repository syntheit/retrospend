/**
 * The engine's recurring conformance cases against the server: every vector
 * (packages/engine/src/recurring-vectors.ts and the template vectors in
 * recurring-conformance.ts, expected values derived by hand there) runs through
 * the confirm and skip mutations, one pass of the auto-post sweep for a poster
 * step, and v1 for a template create or edit, on a real Postgres. The device
 * runs the same cases in packages/engine/src/recurring-conformance.test.ts.
 *
 * Rates are global and a case needs exactly its seed (a missing rate, the
 * newest row on or before a due date), so each reset replaces the table; the
 * rows other files left in this worker's database are put back after. The
 * process zone is the vector's, so a server that read its own zone would book
 * another day.
 */
import { randomUUID } from "node:crypto";
import {
	AMOUNT_FIXED,
	AMOUNT_REQUIRED,
	DATE_BEFORE_PREVIOUS_DUE,
	DATE_IN_FUTURE,
	type RecurringInputKind,
	RecurringInputRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import {
	type PostedRow,
	type RecurringAdapter,
	recurringCases,
} from "../../../../packages/engine/src/recurring-conformance";
import { sweepRecurringAutoPost } from "../recurring-auto-post";
import { confirmRecurringExpense } from "../recurring-confirm.mutation";
import { skipRecurring } from "../recurring-skip.mutation";
import {
	STAMPED,
	sweepOnly,
	v1For,
	v1TemplateBody,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

declare const process: { env: Record<string, string | undefined> };
const originalTZ = process.env.TZ;
let others: Prisma.ExchangeRateCreateManyInput[] = [];

beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
});

afterEach(() => {
	vi.useRealTimers();
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

/** A BAD_REQUEST the confirm's input checks raise, as the domain's own refusal again. */
const INPUT_KINDS: [string, RecurringInputKind][] = [
	[DATE_IN_FUTURE, "date_in_future"],
	[DATE_BEFORE_PREVIOUS_DUE, "date_before_previous_due"],
	[AMOUNT_REQUIRED, "amount_required"],
	[AMOUNT_FIXED, "amount_fixed"],
];

function domainError(error: unknown): unknown {
	if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
		const kind = INPUT_KINDS.find(([message]) => message === error.message);
		if (kind) return new RecurringInputRefusal(kind[1], error.message);
	}
	return error;
}

const text = (value: { toFixed(): string } | null) =>
	value === null ? null : value.toFixed();

function serverAdapter(): RecurringAdapter {
	let userId = "";
	/** The vector's template names, each a uuid here (templates are global rows, v1 wants uuids). */
	const ids = new Map<string, string>();
	const idOf = (name: string) => {
		const id = ids.get(name);
		if (!id) throw new Error(`no template ${name}`);
		return id;
	};
	const rows = async (): Promise<PostedRow[]> =>
		(
			await fixtureDb.expense.findMany({
				where: { userId },
				orderBy: [{ date: "asc" }, { createdAt: "asc" }],
			})
		).map((e) => ({
			id: e.id,
			status: e.status,
			direction: e.direction,
			entryKind: e.entryKind,
			inType: e.inType,
			isAmortizedParent: e.isAmortizedParent,
			excludeFromAnalytics: e.excludeFromAnalytics,
			categoryKind: null,
			categoryId: e.categoryId,
			date: e.date,
			currency: e.currency,
			amount: e.amount.toFixed(),
			amountInUSD: e.amountInUSD.toFixed(),
			exchangeRate: e.exchangeRate.toFixed(),
			rateType: e.rateType,
			homeCurrency: e.homeCurrency ?? "",
			homeRate: text(e.homeRate) ?? "",
			homeAmount: text(e.homeAmount) ?? "",
			pricingSource: e.pricingSource ?? "",
			recurringTemplateId: e.recurringTemplateId,
		}));

	async function run(step: Parameters<RecurringAdapter["step"]>[0]) {
		const templateId = idOf("t1");
		const runner = forUser(userId);
		if (step.call === "skip") {
			await runner.apply(skipRecurring, {
				templateId,
				dueDate: step.dueAt,
				timeZone: step.zone,
			});
			return {};
		}
		if (step.call === "confirm") {
			await runner.apply(confirmRecurringExpense, {
				templateId,
				dueDate: step.dueAt,
				amount: step.confirmedAmount,
				paidOn: step.paidOn,
				timeZone: step.zone,
			});
			return {};
		}
		const counts = await sweepRecurringAutoPost(step.now, sweepOnly(userId));
		if (counts.capped > 0) return { stopped: "cap" as const };
		if (counts.missingRate > 0)
			return { stopped: "refused" as const, refusal: "missing_rate" };
		return {};
	}

	return {
		async reset(seed, tz) {
			process.env.TZ = tz;
			const { user } = await createTestUser();
			userId = user.id;
			await adminDb.user.update({
				where: { id: userId },
				data: {
					homeCurrency: seed.homeCurrency,
					timeZone: seed.timeZone,
					defaultRateTypes: {},
				},
			});
			await adminDb.exchangeRate.deleteMany({});
			await adminDb.exchangeRate.createMany({
				data: seed.rates.map((r) => ({
					currency: r.currency,
					type: r.type,
					rate: r.rate,
					date: r.date,
				})),
			});
			const t = seed.template;
			const made = await fixtureDb.recurringTemplate.create({
				data: {
					userId,
					name: "Rent",
					amount: t.amount,
					currency: t.currency,
					frequency: t.frequency,
					nextDueDate: t.nextDueDate,
					anchorDay: t.anchorDay,
					amountMode: t.amountMode ?? "FIXED",
					autoPay: t.autoPay ?? true,
					isActive: t.isActive ?? true,
					updatedAt: STAMPED,
				},
			});
			ids.clear();
			ids.set("t1", made.id);
		},
		async step(step) {
			const before = new Set((await rows()).map((r) => r.id));
			vi.useFakeTimers({ toFake: ["Date"], now: step.now });
			let result: Awaited<ReturnType<typeof run>>;
			try {
				result = await run(step);
			} catch (error) {
				throw domainError(error);
			} finally {
				vi.useRealTimers();
			}
			const posted = (await rows()).filter((r) => !before.has(r.id));
			return { posted, ...result };
		},
		async template(op) {
			const v1 = await v1For(userId);
			if ("create" in op) {
				const { id, ...input } = op.create;
				const uuid = randomUUID();
				const res = await v1(
					"POST",
					"/recurring",
					v1TemplateBody({ ...input, id: uuid }),
				);
				if (res.status !== 200 && res.status !== 201)
					throw new Error(`create: ${res.status} ${await res.text()}`);
				ids.set(id, uuid);
				return;
			}
			const { id, ...edit } = op.edit;
			const res = await v1(
				"PATCH",
				`/recurring/${idOf(id)}`,
				v1TemplateBody(edit),
			);
			if (res.status !== 200)
				throw new Error(`edit: ${res.status} ${await res.text()}`);
		},
		async read(id) {
			const t = await fixtureDb.recurringTemplate.findUniqueOrThrow({
				where: { id: idOf(id) },
			});
			return {
				nextDueDate: t.nextDueDate,
				anchorDay: t.anchorDay,
				isActive: t.isActive,
				autoPay: t.autoPay,
				amount: t.amount.toFixed(),
				currency: t.currency,
				frequency: t.frequency,
				categoryId: t.categoryId,
				amountMode: t.amountMode,
			};
		},
		expenses: rows,
	};
}

describe("recurring conformance (server, real Postgres)", () => {
	for (const c of recurringCases) it(c.name, () => c.run(serverAdapter));
});
