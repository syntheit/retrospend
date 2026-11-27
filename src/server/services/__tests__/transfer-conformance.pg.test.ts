/**
 * The engine's transfer vectors (packages/engine/src/transfer-vectors.ts,
 * expected values derived by hand there) against the server, on a real
 * Postgres. Each step runs through the real v1 route, then the rows are read
 * back as a device store (src/test/engine-store.ts) and held to the
 * hand-derived values; the same step runs through the engine on the store as
 * it was before the route, and the two stores must be equal row by row on
 * every field the engine keeps (accounts and their versions, legs, snapshots,
 * transfers and every expense), then the figures a transfer can change must
 * read the same on both sides. The fee expense's booked rate is held to the
 * vector's hand values on the server's row. A refusal must carry the engine's
 * words and write nothing; a move the engine sends online must be booked by
 * the server, with its budget side exactly when the engine said it crosses.
 *
 * The process zone is not the saved zone, so a server that read its own zone
 * would date a leg or a fee another day. Rates are global and a case needs
 * exactly its seed, so each reset replaces the table; the rows other files left
 * in this worker's database are put back after.
 */
import { MissingRateError } from "@retrospend/domain/money";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { engineStoreOf } from "~/test/engine-store";
import { deviceReadFrom, expectSame, serverRead } from "~/test/parity/compare";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { planOf } from "../../../../packages/engine/src/device/book";
// The root app does not depend on the engine package; its cases are plain data and code.
import { sameValue } from "../../../../packages/engine/src/equal";
import { LocalDb } from "../../../../packages/engine/src/local-db";
import { TABLE_NAMES } from "../../../../packages/engine/src/port";
import {
	checkTransferState,
	differingTransferRows,
} from "../../../../packages/engine/src/transfer-conformance";
import { TransferOnlineError } from "../../../../packages/engine/src/transfer-kit";
import {
	TRANSFER_CREATE_MUTATION,
	TRANSFER_DELETE_MUTATION,
} from "../../../../packages/engine/src/transfer-mutations";
import {
	type ExpectedFee,
	type TransferStep,
	type TransferVector,
	transferVectors,
} from "../../../../packages/engine/src/transfer-vectors";
import { type V1, v1For } from "./recurring-write-kit";

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

interface Sent {
	method: string;
	path: string;
	body?: object;
}

/** The v1 request an op is. The bodies are the engine's: the same fields the route takes. */
function requestOf(op: TransferStep["op"]): Sent {
	return op.kind === "transferCreate"
		? { method: "POST", path: "/transfers", body: op.body }
		: { method: "DELETE", path: `/transfers/${op.body.id}` };
}

/** The words a refusal carries: the problem's detail, or the first issue the answer lists for a body the schema refuses. */
async function detailOf(res: Response) {
	const text = await res.text();
	const body = JSON.parse(text) as {
		detail?: string;
		errors?: { message: string }[];
	};
	return {
		status: res.status,
		detail: body.detail ?? body.errors?.[0]?.message,
		text,
	};
}

/** The personal budget book of a case: its envelope is the default, so a crossing move has a side to record. */
async function seedBudget(userId: string, currency: string) {
	const book = await fixtureDb.budgetBook.create({
		data: {
			createdById: userId,
			name: "Home",
			currency,
			startDate: new Date("2026-11-01T00:00:00.000Z"),
			startMonth: 202611,
		},
	});
	await fixtureDb.budgetMember.create({
		data: { bookId: book.id, userId, role: "OWNER" },
	});
	await fixtureDb.bookPeriod.create({
		data: { bookId: book.id, fromMonth: 202611, startDay: 1, rateType: "blue" },
	});
	const envelope = await fixtureDb.envelope.create({
		data: { bookId: book.id, name: "To assign", sortOrder: 0 },
	});
	await fixtureDb.budgetBook.update({
		where: { id: book.id },
		data: { defaultEnvelopeId: envelope.id },
	});
}

async function seedServer(vector: TransferVector) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: vector.seed.homeCurrency,
			timeZone: vector.seed.timeZone,
			defaultRateTypes: vector.seed.defaultRateTypes ?? {},
		},
	});
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({
		data: vector.seed.rates.map((r) => ({
			currency: r.currency,
			type: r.type,
			rate: r.rate,
			date: r.date,
		})),
	});
	for (const a of vector.accounts)
		await fixtureDb.assetAccount.create({
			data: {
				id: a.id,
				userId: user.id,
				name: a.name,
				type: a.type as Prisma.AssetAccountCreateInput["type"],
				currency: a.currency,
				balance: a.balance,
				exchangeRate: a.exchangeRate,
				exchangeRateType: a.exchangeRateType,
				countedUnits: a.countedUnits ?? "0",
				closedAt: a.closedAt ?? null,
				inBudget: a.inBudget ?? null,
				createdAt: new Date("2026-10-01T00:00:00Z"),
			},
		});
	if (vector.budget !== "none")
		await seedBudget(user.id, vector.budget.currency);
	return user.id;
}

/** The fee expense as the server stored it, against the vector's hand values. */
async function expectFeeOnServer(id: string, want: ExpectedFee) {
	const row = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
	expect(
		{
			title: row.title,
			description: row.description,
			currency: row.currency,
			homeCurrency: row.homeCurrency,
			rateType: row.rateType,
			date: row.date.toISOString(),
			status: row.status,
			direction: row.direction,
			entryKind: row.entryKind,
			categoryId: row.categoryId,
		},
		`fee ${id}`,
	).toEqual({
		title: want.title,
		description: want.description,
		currency: want.currency,
		homeCurrency: want.homeCurrency,
		rateType: want.rateType,
		date: want.date,
		status: "FINALIZED",
		direction: "OUT",
		entryKind: "STANDARD",
		categoryId: null,
	});
	for (const [name, got, expected] of [
		["amount", row.amount, want.amount],
		["amountInUSD", row.amountInUSD, want.amountInUSD],
		["exchangeRate", row.exchangeRate, want.exchangeRate],
		["homeRate", row.homeRate, want.homeRate],
		["homeAmount", row.homeAmount, want.homeAmount],
	] as const)
		expect(Number(got), `fee ${id} ${name}`).toBe(Number(expected));
}

const FIGURES = ["netWorth", "notTracked", "netWorthChange.exchange", "spent"];

/** The figures a transfer changes, and each account's balance, read on both sides at `now`. */
async function expectFiguresSame(
	userId: string,
	store: Awaited<ReturnType<typeof engineStoreOf>>,
	now: Date,
) {
	expectSame(
		await deviceReadFrom(store, userId, FIGURES, {}, () => now),
		await serverRead(userId, FIGURES),
		FIGURES,
	);
	for (const account of store.list("accounts")) {
		const narrowing = { accountId: account.id };
		expectSame(
			await deviceReadFrom(
				store,
				userId,
				["accounts.balance"],
				narrowing,
				() => now,
			),
			await serverRead(userId, ["accounts.balance"], narrowing),
			["accounts.balance"],
		);
	}
}

const rowsOf = (store: Awaited<ReturnType<typeof engineStoreOf>>) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

/**
 * The vectors reuse their ids (accounts, transfers, legs, fees), so each
 * case's user and everything that hangs off it goes when it ends.
 */
async function forgetUser(userId: string) {
	await adminDb.accountLeg.deleteMany({ where: { userId } });
	await adminDb.transfer.deleteMany({ where: { userId } });
	await adminDb.expense.deleteMany({ where: { userId } });
	await adminDb.assetAccount.deleteMany({ where: { userId } });
}

async function runVector(vector: TransferVector) {
	process.env.TZ = "Pacific/Auckland";
	const userId = await seedServer(vector);
	try {
		await runSteps(vector, userId);
	} finally {
		await forgetUser(userId);
	}
}

async function runSteps(vector: TransferVector, userId: string) {
	const v1: V1 = await v1For(userId);
	for (const step of vector.steps) {
		const now = new Date(step.now);
		const device = await engineStoreOf(userId, { budget: true });
		const { id, write } = planOf(step.op, device.snapshot(), {}, now);
		const sent = requestOf(step.op);
		vi.useFakeTimers({ toFake: ["Date"], now });
		try {
			const res = await v1(sent.method, sent.path, sent.body);
			const want = step.expect;
			const after = await engineStoreOf(userId, { budget: true });
			if ("done" in want) {
				expect(res.status, await res.clone().text()).toBeLessThan(300);
				await checkTransferState(after, want.done, now, { fees: false });
				for (const [feeId, fee] of Object.entries(want.done.expenses ?? {}))
					await expectFeeOnServer(feeId, fee);
				await new LocalDb(device).write(id, write);
				expect(differingTransferRows(device, after)).toEqual([]);
				await expectFiguresSame(userId, device, now);
				continue;
			}
			const before = rowsOf(device);
			const error = await new LocalDb(device)
				.write(id, write)
				.catch((e: unknown) => e);
			// Whatever the device answers, it wrote nothing.
			expect(sameValue(rowsOf(device), before)).toBe(true);
			if ("online" in want) {
				// The server books it: with its budget side exactly when the move crosses the line.
				expect(res.status, await res.clone().text()).toBeLessThan(300);
				expect(error).toBeInstanceOf(TransferOnlineError);
				expect((error as TransferOnlineError).reason).toBe(want.online);
				const sides = await fixtureDb.wealthTransfer.count({
					where: {
						transferId:
							sent.body && "id" in sent.body ? (sent.body.id as string) : "",
					},
				});
				expect(sides).toBe(want.online === "crosses_budget" ? 1 : 0);
				continue;
			}
			const failed = await detailOf(res);
			expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
			// A refusal writes nothing.
			expect(differingTransferRows(await engineStoreOf(userId), after)).toEqual(
				[],
			);
			if ("refused" in want) {
				expect(failed.detail).toBe(want.refused);
				expect((error as Error).message).toBe(want.refused);
			} else {
				expect(error).toBeInstanceOf(MissingRateError);
				expect((error as MissingRateError).currencies).toEqual(
					want.missingRate,
				);
				expect(failed.detail).toBe(
					"No exchange rate for ARS to ZZZ. Type what arrived.",
				);
			}
		} finally {
			vi.useRealTimers();
		}
	}
}

describe("transfer conformance (server and device, real Postgres)", () => {
	for (const vector of transferVectors)
		it(vector.name, () => runVector(vector), 60_000);
});

describe("a transfer the server booked with a budget side", () => {
	it("is the server's to delete: the device sees the side and sends it online", async () => {
		const vector = transferVectors.find((v) =>
			v.name.includes("crossing the line into a home-currency book"),
		);
		if (!vector) throw new Error("vector missing");
		const userId = await seedServer(vector);
		const v1 = await v1For(userId);
		const now = new Date(vector.steps[0]?.now ?? "");
		vi.useFakeTimers({ toFake: ["Date"], now });
		try {
			const create = vector.steps[0];
			if (!create) throw new Error("step missing");
			const sent = requestOf(create.op);
			const res = await v1(sent.method, sent.path, sent.body);
			expect(res.status, await res.clone().text()).toBeLessThan(300);
			const device = await engineStoreOf(userId, { budget: true });
			const { id, write } = planOf(
				{ kind: "transferDelete", body: { id: create.op.body.id } },
				device.snapshot(),
				{},
				now,
			);
			const error = await new LocalDb(device)
				.write(id, write)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(TransferOnlineError);
			expect((error as TransferOnlineError).reason).toBe("has_budget_side");
		} finally {
			vi.useRealTimers();
			await forgetUser(userId);
		}
	}, 60_000);
});

describe("the device mutations touch what the server's do, less the budget's", () => {
	it.each([
		[TRANSFER_CREATE_MUTATION, createTransfer],
		[TRANSFER_DELETE_MUTATION, deleteTransfer],
	])("%s", (device, server) => {
		expect(device.id).toBe(server.id);
		expect([...device.touches]).toEqual(
			server.touches.filter(
				(id) => !id.startsWith("budget.") && id !== "envelope.left",
			),
		);
	});
});
