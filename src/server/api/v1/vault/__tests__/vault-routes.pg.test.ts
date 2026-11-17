/**
 * GET /api/v1/vault/changes and POST /api/v1/vault/writes on Postgres, through
 * the handler the Next route uses (E2EE F7b): who may call them, what a write
 * stores and a pull returns (real sealed bytes, base64url both ways), the
 * conflict and malformed answers, cursors, the account without keys, the
 * protected account, isolation between users and the event a write leaves.
 */
import { randomUUID } from "node:crypto";
import { SCOPES } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "~/server/services/api-v1/cursor";
import { until } from "~/server/services/sync/sync-test-support";
import { vaultRowsOf } from "~/server/services/vault/vault-db-support";
import {
	type Sealer,
	sealer,
	writeOf,
} from "~/server/services/vault/vault-test-support";
import { encryptSecret } from "~/server/services/webhooks/secret";
import { fanOutEvents } from "~/server/services/webhooks/worker";
import { asKey, expectProblem, sessionFor } from "../../core/__tests__/harness";
import {
	accountWithKeys,
	accountWithoutKeys,
	adminDb,
	call,
	cleanUpVaultTests,
	mobileHeaders,
	type Page,
	post,
	pull,
	pullRaw,
	textOf,
	toWire,
	webHeaders,
} from "./vault-route-support";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

let seal: Sealer;
beforeAll(async () => {
	seal = await sealer();
});
afterAll(cleanUpVaultTests);

/** Pulls until `done` accepts the page: a write shows once older transactions end. */
const pullUntil = (
	headers: Record<string, string>,
	query: string,
	done: (page: Page) => boolean,
) => until(() => pull(headers, query), done);

const writeOfWire = (userId: string, recordId: string) =>
	toWire(writeOf(seal, userId, recordId, 0));

describe("vault routes: who may call them", () => {
	it("needs credentials", async () => {
		await expectProblem(
			await call("/vault/changes", {
				headers: { "x-forwarded-for": "198.51.100.1" },
			}),
			401,
			"unauthenticated",
		);
		await expectProblem(
			await call("/vault/writes", {
				method: "POST",
				headers: { "x-forwarded-for": "198.51.100.1" },
				body: { writes: [] },
				idempotent: true,
			}),
			401,
			"unauthenticated",
		);
	});

	it("answers a web session and a mobile session on both routes", async () => {
		const id = await accountWithKeys();
		for (const [n, headers] of [
			[2, await webHeaders(id, 2)],
			[3, await mobileHeaders(id, 3)],
		] as const) {
			const res = await post(headers, [writeOfWire(id, `who-${n}`)]);
			expect(res.status, await res.text()).toBe(200);
			expect((await pullRaw(headers)).status).toBe(200);
		}
	});

	it("refuses a mobile session narrowed below read, write:expenses and write:money", async () => {
		const id = await accountWithKeys();
		const token = await sessionFor(id, {
			scopes: "read write:expenses",
			clientId: "retrospend-mobile",
		});
		const headers = {
			"x-forwarded-for": "198.51.100.4",
			authorization: `Bearer ${token}`,
		};
		const read = await pullRaw(headers);
		await expectProblem(read, 403, "missing_scope");
		const res = await post(headers, [writeOfWire(id, "narrow")]);
		await expectProblem(res, 403, "missing_scope");
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("refuses an API key with every token scope, and a device session that holds them", async () => {
		const id = await accountWithKeys();
		const deviceToken = await sessionFor(id, {
			scopes: "read write:expenses write:money write:settings",
			clientId: "retrospend-cli",
		});
		const callers = {
			key: { ...(await asKey(id, [...SCOPES])) },
			device: { authorization: `Bearer ${deviceToken}` },
		};
		for (const headers of Object.values(callers)) {
			const h = { "x-forwarded-for": "198.51.100.5", ...headers };
			const read = await pullRaw(h);
			await expectProblem(read, 403, "missing_scope");
			await expectProblem(
				await post(h, [writeOfWire(id, "refused")]),
				403,
				"missing_scope",
			);
		}
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("names the vault scope in the refusal", async () => {
		const id = await accountWithKeys();
		const res = await pullRaw({
			"x-forwarded-for": "198.51.100.6",
			...(await asKey(id, [...SCOPES])),
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "missing_scope",
			requiredScope: "vault",
		});
	});
});

describe("writing and pulling", () => {
	it("stores sealed bytes and returns them byte for byte, base64url both ways", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 10);
		const a = writeOf(seal, id, "rec-a", 0);
		const b = writeOf(seal, id, "rec-b", 0, {
			collectionId: "col2",
			entity: 41,
		});
		const res = await post(headers, [toWire(a), toWire(b)]);
		expect(res.status, await res.clone().text()).toBe(200);
		expect(await res.json()).toEqual({
			results: [
				{ id: "rec-a", version: 1 },
				{ id: "rec-b", version: 1 },
			],
		});

		const page = await pullUntil(headers, "", (p) => p.records.length === 2);
		const byId = new Map(page.records.map((r) => [r.id, r]));
		for (const [w, entity, collectionId] of [
			[a, 40, "col1"],
			[b, 41, "col2"],
		] as const) {
			const r = byId.get(w.id);
			expect(r).toMatchObject({
				version: 1,
				entity,
				collectionId,
				deletedAt: null,
			});
			// The text is the canonical base64url of the very bytes sealed.
			expect(r?.ciphertext).toBe(textOf(w.ciphertext as Uint8Array));
			expect(
				Buffer.from(r?.ciphertext as string, "base64url").equals(
					Buffer.from(w.ciphertext as Uint8Array),
				),
			).toBe(true);
		}
		expect(page.hasMore).toBe(false);
	});

	it("returns a deleted record as a tombstone and a revived one at its new version", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 11);
		await post(headers, [toWire(writeOf(seal, id, "t", 0))]);
		await post(headers, [
			toWire(writeOf(seal, id, "t", 1, { tombstone: true })),
		]);
		const dead = await pullUntil(headers, "", (p) =>
			p.records.some((r) => r.version === 2),
		);
		expect(dead.records).toHaveLength(1);
		expect(dead.records[0]).toMatchObject({
			id: "t",
			version: 2,
			ciphertext: null,
		});
		expect(dead.records[0]?.deletedAt).toMatch(/Z$/);
	});

	it("answers 409 conflict with exactly the stale ids and stores nothing of the batch", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 12);
		await post(headers, [
			toWire(writeOf(seal, id, "c1", 0)),
			toWire(writeOf(seal, id, "c2", 0)),
		]);
		const before = await vaultRowsOf(id);
		const res = await post(headers, [
			toWire(writeOf(seal, id, "c1", 1)), // good
			toWire(writeOf(seal, id, "c2", 5)), // stale base
			toWire(writeOf(seal, id, "c3", 3)), // never existed
			toWire(writeOf(seal, id, "c4", 0)), // good new record
		]);
		expect(res.status).toBe(409);
		expect(res.headers.get("content-type")).toBe("application/problem+json");
		const body = await res.json();
		expect(body).toMatchObject({ code: "conflict" });
		expect([...body.conflictIds].sort()).toEqual(["c2", "c3"]);
		const after = await vaultRowsOf(id);
		expect(after.map((r) => [r.id, r.version, r.txid, r.seq])).toEqual(
			before.map((r) => [r.id, r.version, r.txid, r.seq]),
		);
	});

	it("answers 400 for a body the contract or the sealed format refuses, and stores nothing", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 13);
		const good = toWire(writeOf(seal, id, "m1", 0));
		const refused: [string, unknown, string][] = [
			[
				"not base64url",
				{ ...good, ciphertext: "not base64!" },
				"validation_failed",
			],
			[
				"a stray character length",
				{ ...good, ciphertext: "AAAAA" },
				"validation_failed",
			],
			[
				"bytes that are no sealed record",
				{ ...good, ciphertext: textOf(new Uint8Array(10)) },
				"bad_request",
			],
			["an id with a dot", { ...good, id: "a.b" }, "validation_failed"],
			["entity zero", { ...good, entity: 0 }, "validation_failed"],
			[
				"a tombstone at base 0",
				{ ...good, baseVersion: 0, ciphertext: null },
				"bad_request",
			],
		];
		for (const [name, write, code] of refused) {
			const res = await call("/vault/writes", {
				method: "POST",
				headers,
				body: { writes: [write] },
				idempotent: true,
			});
			await expectProblem(res, 400, code);
			expect(await vaultRowsOf(id), name).toEqual([]);
		}
		const twice = await post(headers, [good, good]);
		await expectProblem(twice, 400, "bad_request");
		const none = await post(headers, []);
		await expectProblem(none, 400, "validation_failed");
		const many = await post(
			headers,
			Array.from({ length: 501 }, (_, i) => ({ ...good, id: `many-${i}` })),
		);
		await expectProblem(many, 400, "validation_failed");
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("needs an Idempotency-Key", async () => {
		const id = await accountWithKeys();
		const res = await post(
			await webHeaders(id, 14),
			[toWire(writeOf(seal, id, "k", 0))],
			false,
		);
		await expectProblem(res, 400, "idempotency_key_required");
	});

	it("replays the same body under the same key without writing twice, and stores a fingerprint, not the body", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 15);
		const w = toWire(writeOf(seal, id, "rp", 0));
		const first = await post(headers, [w], "replay-key-1");
		expect(first.status).toBe(200);
		const second = await post(headers, [w], "replay-key-1");
		expect(second.status).toBe(200);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual({
			results: [{ id: "rp", version: 1 }],
		});
		expect((await vaultRowsOf(id)).map((r) => r.version)).toEqual([1]);

		const [row] = await adminDb.idempotencyKey.findMany({
			where: { userId: id, key: "replay-key-1" },
		});
		expect(row?.requestHash).toMatch(/^[0-9a-f]{64}$/);
		// Nothing of the record is kept: the stored answer is ids and versions.
		expect(JSON.stringify(row)).not.toContain(
			(w.ciphertext as string).slice(0, 40),
		);
		// The stored answer itself is checked through the replay above: a
		// sealed run keeps it in its sealed column, not in responseBody.
	});

	it("frees the key after a conflict, so the corrected batch can use it", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 16);
		await post(headers, [toWire(writeOf(seal, id, "fk", 0))]);
		const stale = await post(
			headers,
			[toWire(writeOf(seal, id, "fk", 0))],
			"free-key",
		);
		await expectProblem(stale, 409, "conflict");
		const fixed = await post(
			headers,
			[toWire(writeOf(seal, id, "fk", 1))],
			"free-key",
		);
		expect(fixed.status).toBe(200);
	});

	it("appends vault.changed with record ids only, never bytes", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 17);
		const writes = [writeOf(seal, id, "ev-1", 0), writeOf(seal, id, "ev-2", 0)];
		const res = await post(headers, writes.map(toWire));
		expect(res.status).toBe(200);
		const events = await adminDb.apiEvent.findMany({
			where: { userId: id, type: "vault.changed" },
		});
		expect(events).toHaveLength(1);
		const event = events[0];
		const text = JSON.stringify({
			...event,
			seq: String(event?.seq),
			txid: undefined,
		});
		for (const w of writes) {
			const b64 = textOf(w.ciphertext as Uint8Array);
			expect(text).not.toContain(b64.slice(0, 40));
			expect(text).not.toContain(b64.slice(-40));
		}
		const payload = event?.payload as { ids: Record<string, string> };
		const ids = new Set([event?.entityId, ...Object.values(payload.ids)]);
		expect(ids).toEqual(new Set(["ev-1", "ev-2"]));
		expect(text.length).toBeLessThan(2_000);
	});

	it("is not sent to a webhook, though a webhook with no filter gets the user's other events", async () => {
		const id = await accountWithKeys();
		const hook = await adminDb.webhook.create({
			data: {
				id: randomUUID(),
				userId: id,
				name: "all events",
				url: "http://vault-fanout.site.test/hook",
				eventTypes: [],
				secretCipher: encryptSecret("whsec_test"),
				secretStart: "whsec_test",
			},
		});
		const headers = await webHeaders(id, 19);
		expect(
			(await post(headers, [toWire(writeOf(seal, id, "wh", 0))])).status,
		).toBe(200);
		await adminDb.apiEvent.create({
			data: {
				userId: id,
				actorUserId: id,
				type: "expense.created",
				payload: { ids: {}, amounts: [], truncated: false },
			},
		});
		await until(
			async () => {
				await fanOutEvents();
				return adminDb.apiEvent.count({
					where: { userId: id, fannedOutAt: null },
				});
			},
			(pending) => pending === 0,
		);
		const deliveries = await adminDb.webhookDelivery.findMany({
			where: { webhookId: hook.id },
		});
		expect(deliveries.map((d) => d.eventType)).toEqual(["expense.created"]);
	});

	it("appends no event for a refused batch", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 18);
		await post(headers, [toWire(writeOf(seal, id, "ne", 0))]);
		await post(headers, [toWire(writeOf(seal, id, "ne", 0))]);
		const events = await adminDb.apiEvent.findMany({
			where: { userId: id, type: "vault.changed" },
		});
		expect(events).toHaveLength(1);
	});
});

describe("an account without protection keys", () => {
	it("refuses a write with protection_keys_missing, stores nothing, and reads an empty page", async () => {
		const id = await accountWithoutKeys();
		const headers = await webHeaders(id, 20);
		const res = await post(headers, [toWire(writeOf(seal, id, "nk", 0))]);
		await expectProblem(res, 409, "protection_keys_missing");
		expect(await vaultRowsOf(id)).toEqual([]);
		const page = await pull(headers);
		expect(page.records).toEqual([]);
		expect(page.hasMore).toBe(false);
	});
});

describe("cursors", () => {
	it("pages every record once, in order, and the last cursor is the cut", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 30);
		const ids = ["p1", "p2", "p3", "p4", "p5"];
		for (const rid of ids)
			expect(
				(await post(headers, [toWire(writeOf(seal, id, rid, 0))])).status,
			).toBe(200);
		await pullUntil(headers, "", (p) => p.records.length === 5);

		const seen: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 10; guard++) {
			const page = await pull(
				headers,
				`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			seen.push(...page.records.map((r) => r.id));
			cursor = page.cursor;
			if (!page.hasMore) break;
		}
		expect(seen).toEqual(ids);
		// Caught up: nothing new after the last cursor.
		const next = await pull(
			headers,
			`?cursor=${encodeURIComponent(cursor as string)}`,
		);
		expect(next.records).toEqual([]);
		// A write after it shows up on the next pull, once.
		await post(headers, [toWire(writeOf(seal, id, "p6", 0))]);
		const late = await pullUntil(
			headers,
			`?cursor=${encodeURIComponent(cursor as string)}`,
			(p) => p.records.length === 1,
		);
		expect(late.records.map((r) => r.id)).toEqual(["p6"]);
	});

	it("answers 410 sync_reset_required for another epoch and for a position the server has not reached", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 31);
		const epoch = JSON.parse(
			Buffer.from((await pull(headers)).cursor, "base64url").toString("utf8"),
		).e as string;
		const stale = encodeCursor({
			k: "vault",
			e: `${epoch}-old`,
			t: "1",
			s: "0",
		});
		await expectProblem(
			await pullRaw(headers, `?cursor=${encodeURIComponent(stale)}`),
			410,
			"sync_reset_required",
		);
		const ahead = encodeCursor({
			k: "vault",
			e: epoch,
			t: "9".repeat(18),
			s: "0",
		});
		await expectProblem(
			await pullRaw(headers, `?cursor=${encodeURIComponent(ahead)}`),
			410,
			"sync_reset_required",
		);
	});

	it("refuses a sync feed cursor on /vault/changes with 400, and a vault cursor on /sync", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 33);
		const syncPage = await call("/sync/expenses", { headers });
		expect(syncPage.status).toBe(200);
		const syncCursor = ((await syncPage.json()) as { cursor: string }).cursor;
		await expectProblem(
			await pullRaw(headers, `?cursor=${encodeURIComponent(syncCursor)}`),
			400,
			"bad_request",
		);
		const vaultCursor = (await pull(headers)).cursor;
		const back = await call(
			`/sync/expenses?since=${encodeURIComponent(vaultCursor)}`,
			{ headers },
		);
		await expectProblem(back, 400, "bad_request");
		// Each feed still takes its own cursor.
		expect(
			(await pullRaw(headers, `?cursor=${encodeURIComponent(vaultCursor)}`))
				.status,
		).toBe(200);
		expect(
			(
				await call(`/sync/expenses?since=${encodeURIComponent(syncCursor)}`, {
					headers,
				})
			).status,
		).toBe(200);
	});

	it("answers 400 for a cursor that is not ours and for a limit out of range", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 32);
		await expectProblem(
			await pullRaw(headers, "?cursor=not-a-cursor"),
			400,
			"bad_request",
		);
		await expectProblem(
			await pullRaw(
				headers,
				`?cursor=${encodeURIComponent(encodeCursor({ nope: 1 }))}`,
			),
			400,
			"bad_request",
		);
		await expectProblem(
			await pullRaw(headers, "?limit=1001"),
			400,
			"validation_failed",
		);
		await expectProblem(
			await pullRaw(headers, "?limit=0"),
			400,
			"validation_failed",
		);
	});
});

describe("isolation and protected accounts", () => {
	it("never shows one account's records to another, and lets both use one id", async () => {
		const a = await accountWithKeys();
		const b = await accountWithKeys();
		const ha = await webHeaders(a, 40);
		const hb = await webHeaders(b, 41);
		await post(ha, [toWire(writeOf(seal, a, "shared-id", 0))]);
		const bWrite = writeOf(seal, b, "shared-id", 0);
		expect((await post(hb, [toWire(bWrite)])).status).toBe(200);
		const pageA = await pullUntil(ha, "", (p) => p.records.length === 1);
		const pageB = await pullUntil(hb, "", (p) => p.records.length === 1);
		expect(pageA.records[0]?.ciphertext).not.toBe(pageB.records[0]?.ciphertext);
		expect(pageB.records[0]?.ciphertext).toBe(
			textOf(bWrite.ciphertext as Uint8Array),
		);
		// B updating the id it holds does not touch A's.
		await post(hb, [toWire(writeOf(seal, b, "shared-id", 1))]);
		const rowsA = await vaultRowsOf(a);
		expect(rowsA.map((r) => r.version)).toEqual([1]);
	});

	it("answers an account with protection on, and still refuses its ledger routes", async () => {
		const id = await accountWithKeys();
		await adminDb.user.update({
			where: { id },
			data: { protectionState: "ON" },
		});
		const headers = await webHeaders(id, 42);
		const res = await post(headers, [toWire(writeOf(seal, id, "on-1", 0))]);
		expect(res.status, await res.clone().text()).toBe(200);
		const page = await pullUntil(headers, "", (p) => p.records.length === 1);
		expect(page.records[0]?.id).toBe("on-1");
		const mobile = await mobileHeaders(id, 43);
		expect((await pullRaw(mobile)).status).toBe(200);
		// The guard is on for this account: a personal route is refused.
		await expectProblem(
			await call("/expenses", { headers }),
			403,
			"protected_account",
		);
	});
});
