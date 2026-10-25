/**
 * /api/v1/accounts on Postgres: add, edit, close, reopen, delete, Update
 * balance and the rate type switch through the web's own mutations, with
 * previews that equal the result, idempotent replay, single-use stale-safe
 * undo tokens, other people's accounts as 404, and net worth that adds up.
 * USD home, so every value is worked out by hand.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.accounts;
const usd = (minor: number) => ({ minor, currency: "USD" });
type Money = { minor: number; currency: string };
type Item = {
	id: string;
	name: string;
	balance: Money;
	value: Money | null;
	closedAt: string | null;
};
type Preview = {
	changes: { id: string; delta: Money }[];
	detail?: { kind: string; result: unknown };
};
type Write = { result: Record<string, unknown>; undo: string | null };

/** What differs between a dry run and the real write: clocks and ids the database makes. */
const VOLATILE = new Set(["updatedAt", "closedAt", "legId", "rateTypeId"]);
const bare = (v: unknown) =>
	JSON.parse(
		JSON.stringify(v, (k, x) => (VOLATILE.has(k) ? undefined : x)),
	) as unknown;

describe("/api/v1/accounts", () => {
	useApiV1();
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let userId: string;

	const send = (
		method: string,
		path: string,
		body?: unknown,
		headers = as,
		key?: string,
	) =>
		call(path, {
			method,
			headers,
			body,
			idempotent: method === "GET" ? false : (key ?? true),
		});
	const list = async () =>
		(
			await expectBody<{ accounts: Item[] }>(
				await call("/accounts", { headers: as }),
				c.list,
			)
		).accounts;
	const find = async (id: string) => (await list()).find((a) => a.id === id);
	const undo = (token: string | null, headers = as) =>
		send("POST", "/accounts/undo", { token }, headers);
	const newAccount = (over: Record<string, unknown> = {}) => ({
		id: randomUUID(),
		name: "Wise",
		type: "CASH",
		currency: "USD",
		balance: "250.50",
		...over,
	});

	/** Preview, then write: nothing changed in between, and both answer alike. */
	async function twin(
		path: string,
		body: unknown,
		routes: { write: unknown; preview: unknown },
		opts: { method?: string; status?: number } = {},
	) {
		const preview = await expectBody<Preview>(
			await send("POST", `${path}/preview`, body),
			routes.preview as never,
		);
		const written = await expectBody<Write>(
			await send(opts.method ?? "POST", path, body),
			routes.write as never,
			opts.status ?? 200,
		);
		expect(bare(written.result)).toEqual(bare(preview.detail?.result));
		return { preview, written };
	}

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		stranger = await asMobile((await createTestUser()).user.id);
	});

	it("previews adding an account, writes nothing, then adds it", async () => {
		const body = newAccount();
		const preview = await expectBody<Preview>(
			await send("POST", "/accounts/preview", body),
			c.previewCreate,
		);
		expect(preview.changes.find((x) => x.id === "netWorth")?.delta).toEqual(
			usd(25_050),
		);
		expect(await find(body.id)).toBeUndefined();

		const written = await expectBody<Write>(
			await send("POST", "/accounts", body),
			c.create,
			201,
		);
		expect(bare(written.result)).toEqual(bare(preview.detail?.result));
		expect(await find(body.id)).toMatchObject({
			name: "Wise",
			balance: usd(25_050),
			value: usd(25_050),
		});
		await expectProblem(await send("POST", "/accounts", body), 409, "conflict");
	});

	it("replays a write with the same Idempotency-Key", async () => {
		const body = newAccount({ name: "Cash box" });
		const key = randomUUID();
		const first = await send("POST", "/accounts", body, as, key);
		const again = await send("POST", "/accounts", body, as, key);
		expect(first.status).toBe(201);
		expect(JSON.parse(await again.text())).toEqual(
			JSON.parse(await first.text()),
		);
		await expect(
			adminDb.assetAccount.count({ where: { userId, name: "Cash box" } }),
		).resolves.toBe(1);
	});

	it("refuses an amount with more decimals than the currency has (400)", async () => {
		await expectProblem(
			await send("POST", "/accounts", newAccount({ balance: "10.123" })),
			400,
			"bad_request",
		);
		await expectProblem(
			await send("POST", "/accounts", newAccount({ balance: "10,5" })),
			400,
			"validation_failed",
		);
	});

	it("takes a new account back only while nothing was written against it", async () => {
		const body = newAccount({ name: "Temp" });
		const made = await expectBody<Write>(
			await send("POST", "/accounts", body),
			c.create,
			201,
		);
		const dry = await expectBody<Preview>(
			await send("POST", "/accounts/undo/preview", { token: made.undo }),
			c.previewUndo,
		);
		expect(dry.detail?.kind).toBe("account.delete");
		expect(await find(body.id)).toBeDefined();
		await expectBody(await undo(made.undo), c.undo);
		expect(await find(body.id)).toBeUndefined();
		await expectProblem(await undo(made.undo), 409, "conflict");

		const used = newAccount({ name: "Used" });
		const second = await expectBody<Write>(
			await send("POST", "/accounts", used),
			c.create,
			201,
		);
		await expectBody(
			await send("POST", `/accounts/${used.id}/balance`, { balance: "300" }),
			c.updateBalance,
		);
		await expectProblem(await undo(second.undo), 409, "conflict");
		expect(await find(used.id)).toBeDefined();
	});

	it("updates the balance, records Not logged and undoes it once", async () => {
		const body = newAccount({ name: "Checking", balance: "100" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const { preview, written } = await twin(
			`/accounts/${body.id}/balance`,
			{ id: body.id, balance: "120.25" },
			{ write: c.updateBalance, preview: c.previewUpdateBalance },
		);
		expect(preview.changes.find((x) => x.id === "netWorth")?.delta).toEqual(
			usd(2_025),
		);
		expect(written.result).toMatchObject({
			before: usd(10_000),
			after: usd(12_025),
			notLogged: usd(2_025),
		});
		expect((await find(body.id))?.balance).toEqual(usd(12_025));

		await expectBody(await undo(written.undo), c.undo);
		expect((await find(body.id))?.balance).toEqual(usd(10_000));
		await expectProblem(await undo(written.undo), 409, "conflict");
	});

	it("refuses to undo a balance update once the account moved on (409)", async () => {
		const body = newAccount({ name: "Savings", balance: "50" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const first = await expectBody<Write>(
			await send("POST", `/accounts/${body.id}/balance`, { balance: "60" }),
			c.updateBalance,
		);
		await expectBody(
			await send("POST", `/accounts/${body.id}/balance`, { balance: "70" }),
			c.updateBalance,
		);
		await expectProblem(await undo(first.undo), 409, "conflict");
		expect((await find(body.id))?.balance).toEqual(usd(7_000));
	});

	it("edits an account and puts the old fields back", async () => {
		const body = newAccount({ name: "Old name", balance: "10" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const { written } = await twin(
			`/accounts/${body.id}`,
			{ ...body, name: "New name" },
			{ write: c.update, preview: c.previewUpdate },
			{ method: "PUT" },
		);
		expect((await find(body.id))?.name).toBe("New name");
		await expectBody(await undo(written.undo), c.undo);
		expect((await find(body.id))?.name).toBe("Old name");
	});

	it("closes and reopens an account, each undone by the other", async () => {
		const body = newAccount({ name: "Spare", balance: "5" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const closed = await twin(
			`/accounts/${body.id}/close`,
			{ id: body.id },
			{ write: c.close, preview: c.previewClose },
		);
		expect((await find(body.id))?.closedAt).toEqual(expect.any(String));
		await expectBody(await undo(closed.written.undo), c.undo);
		expect((await find(body.id))?.closedAt).toBeNull();
		const again = await twin(
			`/accounts/${body.id}/close`,
			{ id: body.id },
			{ write: c.close, preview: c.previewClose },
		);
		const reopened = await twin(
			`/accounts/${body.id}/reopen`,
			{ id: body.id },
			{ write: c.reopen, preview: c.previewReopen },
		);
		expect(again.written.undo).toBeTruthy();
		expect((await find(body.id))?.closedAt).toBeNull();
		await expectProblem(await undo(again.written.undo), 409, "conflict");
		expect(reopened.written.undo).toBeTruthy();
	});

	it("switches the rate type and takes the switch back", async () => {
		const body = newAccount({ name: "Brokerage", type: "INVESTMENT" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const { written } = await twin(
			`/accounts/${body.id}/rate-type`,
			{ id: body.id, rateType: "blue" },
			{ write: c.setRateType, preview: c.previewSetRateType },
		);
		expect((await find(body.id)) && (await list()).length).toBeGreaterThan(0);
		await expectBody(await undo(written.undo), c.undo);
	});

	it("deletes an account with its history and offers no undo", async () => {
		const body = newAccount({ name: "Gone" });
		await expectBody(await send("POST", "/accounts", body), c.create, 201);
		const { written } = await twin(
			`/accounts/${body.id}/delete`,
			{ id: body.id },
			{ write: c.delete, preview: c.previewDelete },
		);
		expect(written.undo).toBeNull();
		expect(await find(body.id)).toBeUndefined();
	});

	it("answers 404 for another person's account and keeps tokens private", async () => {
		const body = newAccount({ name: "Private" });
		const made = await expectBody<Write>(
			await send("POST", "/accounts", body),
			c.create,
			201,
		);
		for (const [method, path] of [
			["GET", `/accounts/${body.id}`],
			["POST", `/accounts/${body.id}/close`],
			["POST", `/accounts/${body.id}/balance`],
		] as const)
			await expectProblem(
				await send(
					method,
					path,
					method === "GET" ? undefined : { balance: "1" },
					stranger,
				),
				404,
				"not_found",
			);
		await expectProblem(await undo(made.undo, stranger), 400, "bad_request");
	});

	it("reads net worth: the headline, the parts that add up and a series ending on it", async () => {
		const worth = await expectBody<{
			netWorth: Money | null;
			change: { total: Money; parts: Record<string, Money> } | null;
			series: { date: string; value: Money | null }[];
		}>(await call("/accounts/net-worth?days=14", { headers: as }), c.netWorth);
		const open = (await list()).filter((a) => !a.closedAt);
		const sum = open.reduce((t, a) => t + (a.value?.minor ?? 0), 0);
		expect(worth.netWorth).toEqual(usd(sum));
		expect(worth.series).toHaveLength(14);
		expect(worth.series.at(-1)?.value).toEqual(worth.netWorth);
		const parts = Object.values(worth.change?.parts ?? {}).reduce(
			(t, m) => t + m.minor,
			0,
		);
		expect(parts).toBe(worth.change?.total.minor);
	});

	it("keeps a default account per currency", async () => {
		const [first] = await list();
		const set = await expectBody<{ defaults: Record<string, string> }>(
			await send("PUT", "/accounts/defaults/USD", {
				currency: "USD",
				accountId: first?.id,
			}),
			c.setDefault,
		);
		expect(set.defaults.USD).toBe(first?.id);
		const read = await expectBody<{ defaults: Record<string, string> }>(
			await call("/accounts/defaults", { headers: as }),
			c.defaults,
		);
		expect(read.defaults.USD).toBe(first?.id);
		const csv = await expectBody<{ csv: string }>(
			await call("/accounts/export", { headers: as }),
			c.export,
		);
		expect(csv.csv).toContain("name,type,currency,balance");
	});

	it("writes a negative balance in the CSV as a number, and keeps the guard on text", async () => {
		await expectBody(
			await send(
				"POST",
				"/accounts",
				newAccount({ name: "=Overdrawn", balance: "-50" }),
			),
			c.create,
			201,
		);
		const csv = (
			await expectBody<{ csv: string }>(
				await call("/accounts/export", { headers: as }),
				c.export,
			)
		).csv;
		// The name is text a person typed, so a formula guard prefixes it; the balance is a number.
		expect(csv).toContain("'=Overdrawn,CASH,USD,-50,-50,");
		expect(csv).not.toContain("'-50");
	});
});
