/**
 * What bounds POST /api/v1/vault/writes (E2EE F7b): the body cap before the
 * body is parsed (a declared length and a streamed one), a full legitimate
 * batch (500 writes, just under 8 MiB of ciphertext) going through, an
 * all-conflict full batch finishing inside the transaction timeout, and the
 * per-account write limit.
 */
import { contract } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { until } from "~/server/services/sync/sync-test-support";
import { VAULT_WRITE_TIMEOUT_MS } from "~/server/services/vault/vault-api.service";
import { vaultRowsOf } from "~/server/services/vault/vault-db-support";
import {
	contextOf,
	type Sealer,
	sealer,
	writeOf,
} from "~/server/services/vault/vault-test-support";
import { BASE, expectProblem } from "../../core/__tests__/harness";
import { handleV1Request } from "../../handler";
import { VAULT_WRITES_BODY_LIMIT } from "../body-limit";
import { VAULT_WRITE_LIMIT } from "../index";
import {
	accountWithKeys,
	adminDb,
	cleanUpVaultTests,
	expectBody,
	type Page,
	post,
	pull,
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

/** 500 records of this many sealed bytes fit 8 MiB (500 x 16762 = 8,381,000 of 8,388,608). */
const FULL_RECORD_BYTES = 58 + 261 * 64;

/** The note length whose sealed record is exactly `bytes` long (sealed size does not depend on the place). */
function noteLengthFor(seal: Sealer, bytes: number): number {
	const probe = contextOf("u", "probe", 0);
	for (let note = bytes - 160; note < bytes; note++)
		if (seal(probe, { note: "x".repeat(note) }).length === bytes) return note;
	throw new Error("no note length seals to that size");
}

function fullBatch(
	userId: string,
	ids: (i: number) => string,
	base: number,
	note: number,
) {
	return Array.from({ length: 500 }, (_, i) =>
		toWire(
			writeOf(seal, userId, ids(i), base, {
				record: { note: "x".repeat(note) },
			}),
		),
	);
}

/** A POST to the route with a hand-made body and headers, to control what is declared. */
async function rawPost(
	headers: Record<string, string>,
	body: BodyInit,
	extra: Record<string, string> = {},
	key = crypto.randomUUID(),
) {
	return handleV1Request(
		new Request(`${BASE}/vault/writes`, {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/json",
				"idempotency-key": key,
				...extra,
			},
			body,
			duplex: "half",
		} as RequestInit),
	);
}

describe("the body cap", () => {
	it("refuses a declared length over the cap with 413 before anything runs", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 60);
		const key = "cap-declared";
		const res = await rawPost(
			headers,
			"{}",
			{ "content-length": String(VAULT_WRITES_BODY_LIMIT + 1) },
			key,
		);
		await expectProblem(res, 413, "payload_too_large");
		// No credential check, no idempotency row, no write.
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: id, key } }),
		).toBe(0);
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("cuts off a streamed body that never declares a length, with 413", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 61);
		const key = "cap-chunked";
		const chunk = new TextEncoder().encode(
			`{"writes":[${"0".repeat(1024 * 1024)}`,
		);
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent > VAULT_WRITES_BODY_LIMIT) controller.close();
				else {
					sent += chunk.byteLength;
					controller.enqueue(chunk);
				}
			},
		});
		const res = await rawPost(headers, body, {}, key);
		await expectProblem(res, 413, "payload_too_large");
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: id, key } }),
		).toBe(0);
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("never stores a streamed body over the cap even when its start is a valid batch", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 64);
		const key = "cap-valid-prefix";
		const enc = new TextEncoder();
		const valid = JSON.stringify({
			writes: [toWire(writeOf(seal, id, "prefix-1", 0))],
		});
		// The batch is complete JSON; whitespace after it is still JSON, so a
		// parser handed the prefix alone would accept it.
		const head = enc.encode(valid);
		const pad = enc.encode(" ".repeat(1024 * 1024));
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent === 0) {
					sent += head.byteLength;
					controller.enqueue(head);
				} else if (sent > VAULT_WRITES_BODY_LIMIT) controller.close();
				else {
					sent += pad.byteLength;
					controller.enqueue(pad);
				}
			},
		});
		const res = await rawPost(headers, body, {}, key);
		await expectProblem(res, 413, "payload_too_large");
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: id, key } }),
		).toBe(0);
		expect(await vaultRowsOf(id)).toEqual([]);
	});

	it("leaves the cap to this route only: another JSON route takes a body of the same size", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 62);
		const res = await handleV1Request(
			new Request(`${BASE}/me/consent`, {
				method: "POST",
				headers: {
					...headers,
					"content-type": "application/json",
					"idempotency-key": "other-json",
				},
				body: JSON.stringify({
					junk: "x".repeat(VAULT_WRITES_BODY_LIMIT + 10),
				}),
			}),
		);
		// Whatever it answers, it is not the vault's 413.
		expect(res.status).not.toBe(413);
	});

	it("accepts a full batch: 500 writes, just under 8 MiB of ciphertext, and returns every record", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 63);
		const note = noteLengthFor(seal, FULL_RECORD_BYTES);
		const writes = fullBatch(
			id,
			(i) => `full-${String(i).padStart(3, "0")}`,
			0,
			note,
		);
		const size = JSON.stringify({ writes }).length;
		const ciphertextBytes = writes.reduce(
			(n, w) => n + Buffer.from(w.ciphertext as string, "base64url").length,
			0,
		);
		expect(ciphertextBytes).toBeGreaterThan(8_300_000);
		expect(ciphertextBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
		// A real full batch is close to the cap and under it.
		expect(size).toBeGreaterThan(11_000_000);
		expect(size).toBeLessThan(VAULT_WRITES_BODY_LIMIT);

		const res = await post(headers, writes);
		const out = await expectBody<{
			results: { id: string; version: number }[];
		}>(res, contract.vault.writes);
		expect(out.results).toHaveLength(500);
		expect(out.results.every((r) => r.version === 1)).toBe(true);
		expect((await vaultRowsOf(id)).length).toBe(500);

		// Pulled back in pages of about 4 MiB, every byte as sent.
		const got = new Map<string, string | null>();
		let cursor: string | undefined;
		let pages = 0;
		await until(
			async () => (await pull(headers, "?limit=1000")).records.length,
			(n) => n === 500 || pages++ > 40,
		);
		for (let guard = 0; guard < 20; guard++) {
			const page: Page = await pull(
				headers,
				cursor
					? `?limit=1000&cursor=${encodeURIComponent(cursor)}`
					: "?limit=1000",
			);
			for (const r of page.records) got.set(r.id, r.ciphertext);
			cursor = page.cursor;
			if (!page.hasMore) break;
		}
		expect(got.size).toBe(500);
		for (const w of writes) expect(got.get(w.id)).toBe(w.ciphertext);
	}, 120_000);

	it("finishes an all-conflict full batch inside the transaction timeout, with every id listed", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 64);
		const note = noteLengthFor(seal, FULL_RECORD_BYTES);
		const ids = (i: number) => `clash-${String(i).padStart(3, "0")}`;
		expect((await post(headers, fullBatch(id, ids, 0, note))).status).toBe(200);

		// The same ids at base 0 again, with other bytes: each one is a conflict, none a replay.
		const again = fullBatch(id, ids, 0, note - 1);
		const started = Date.now();
		const res = await post(headers, again);
		const took = Date.now() - started;
		await expectProblem(res.clone(), 409, "conflict");
		expect((await res.json()).conflictIds).toHaveLength(500);
		expect(took).toBeLessThan(VAULT_WRITE_TIMEOUT_MS);
		// Nothing changed: still version 1 everywhere.
		expect((await vaultRowsOf(id)).every((r) => r.version === 1)).toBe(true);
	}, 120_000);
});

describe("the write limit", () => {
	it("allows the configured batches a minute per account, then answers 429 with Retry-After", async () => {
		const id = await accountWithKeys();
		const headers = await webHeaders(id, 65);
		// The limiter counts in fixed minute windows read from the clock, so on a
		// slow run the batches could straddle a boundary and the count would reset.
		// Pin the clock to the middle of the current window (only Date, so I/O timers run).
		const { windowMs } = VAULT_WRITE_LIMIT;
		const mid = Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2;
		vi.useFakeTimers({ toFake: ["Date"], now: mid });
		try {
			for (let i = 0; i < VAULT_WRITE_LIMIT.limit; i++) {
				const res = await post(headers, [
					toWire(writeOf(seal, id, `rl-${i}`, 0)),
				]);
				expect(res.status, `write ${i}`).toBe(200);
			}
			const res = await post(headers, [
				toWire(writeOf(seal, id, "rl-over", 0)),
			]);
			await expectProblem(res.clone(), 429, "rate_limited");
			// Pinned at the middle of the window: the wait is exactly the other half.
			expect(Number(res.headers.get("retry-after"))).toBe(windowMs / 2000);
		} finally {
			vi.useRealTimers();
		}
		expect((await vaultRowsOf(id)).length).toBe(VAULT_WRITE_LIMIT.limit);
		// Another account is not held back by it.
		const other = await accountWithKeys();
		const ok = await post(await webHeaders(other, 66), [
			toWire(writeOf(seal, other, "rl-0", 0)),
		]);
		expect(ok.status).toBe(200);
		// Reads are not counted against it.
		expect((await pull(headers)).records).toBeDefined();
	}, 60_000);
});
