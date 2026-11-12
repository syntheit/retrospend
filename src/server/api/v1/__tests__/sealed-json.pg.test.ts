/**
 * The JSON copies in idempotency_key (E2EE D11 PR 8.1) on Postgres, in both
 * suites. A replayed v1 write and an undo stash read back the same body; in
 * the sealed suite each is stored as a `{ sealed }` envelope under the row
 * owner's key and its own row id, with the text nowhere in the row, and a
 * body moved to another row fails instead of replaying. A client key with a
 * server prefix is refused, so a server row cannot be forged.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openField } from "~/server/crypto/field-crypto";
import { createUserScopedDb } from "~/server/db";
import {
	arsUser,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import {
	completeIdempotentRequest,
	startIdempotentRequest,
} from "~/server/services/api-v1/idempotency.service";
import { ensureUserKeyring } from "~/server/services/keys/data-key.service";
import { adminDb, sealedSuite } from "~/test/pg-harness";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.accounts;
const NAME = "Caja fuerte de Ana";

let userId: string;
let as: Record<string, string>;

beforeAll(async () => {
	await seedArsRates();
	userId = (await arsUser()).user.id;
	as = await asMobile(userId);
});

const send = (path: string, body: unknown, key: string = randomUUID()) =>
	call(path, {
		method: "POST",
		headers: { ...as, "x-forwarded-for": "198.51.100.90" },
		body,
		idempotent: key,
	});

/** The stored row, read raw, and its body as the owner reads it. */
async function stored(key: string) {
	const [row] = await adminDb.$queryRaw<
		{ id: string; requestHash: string; body: unknown; text: string }[]
	>`SELECT "id", "requestHash", "responseBody" AS "body", "responseBody"::text AS "text"
		FROM "idempotency_key" WHERE "userId" = ${userId} AND "key" = ${key}`;
	if (!row) throw new Error(`no idempotency_key row for ${key}`);
	if (!sealedSuite) return { ...row, opened: row.body };
	const { sealed } = row.body as { sealed: string };
	expect(sealed.startsWith("\u0001k1:")).toBe(true);
	expect(Object.keys(row.body as object)).toEqual(["sealed"]);
	const ring = await ensureUserKeyring(userId);
	const opened = JSON.parse(
		openField(ring, sealed, {
			table: "idempotency_key",
			column: "responseBody",
			rowId: row.id,
		}),
	);
	return { ...row, opened };
}

describe("a replayed v1 write", () => {
	it("returns the stored body, sealed at rest in the sealed suite", async () => {
		const key = randomUUID();
		const body = {
			id: randomUUID(),
			name: NAME,
			type: "CASH",
			currency: "ARS",
			balance: "154500",
		};
		const first = await expectBody(
			await send("/accounts", body, key),
			c.create,
			201,
		);
		const again = await send("/accounts", body, key);
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect(await expectBody(again, c.create, 201)).toEqual(first);

		const row = await stored(key);
		expect(row.opened).toEqual(first);
		expect(row.text.includes(NAME)).toBe(!sealedSuite);
	});
});

describe("an undo stash", () => {
	it("puts the deleted account back from a body sealed at rest in the sealed suite", async () => {
		const id = randomUUID();
		await expectBody(
			await send("/accounts", {
				id,
				name: NAME,
				type: "CASH",
				currency: "ARS",
				balance: "1000",
			}),
			c.create,
			201,
		);
		const deleted = await expectBody<{ undo: string }>(
			await send(`/accounts/${id}/delete`, { id }),
			c.delete,
		);

		const [stash] = await adminDb.idempotencyKey.findMany({
			where: { userId, key: { startsWith: "undo-stash:" } },
			select: { key: true },
		});
		const row = await stored(stash?.key ?? "");
		expect((row.opened as { account: { name: string } }).account.name).toBe(
			NAME,
		);
		expect(row.text.includes(NAME)).toBe(!sealedSuite);

		await expectBody(
			await send("/accounts/undo", { token: deleted.undo }),
			c.undo,
		);
		const back = await createUserScopedDb(
			userId,
		).assetAccount.findUniqueOrThrow({
			where: { id },
			select: { name: true },
		});
		expect(back.name).toBe(NAME);
	});
});

describe("a body moved to another row", () => {
	it.runIf(sealedSuite)(
		"fails both reads instead of replaying the other body",
		async () => {
			const db = createUserScopedDb(userId);
			const keys = [randomUUID(), randomUUID()] as const;
			for (const [i, key] of keys.entries()) {
				const start = await startIdempotentRequest(db, {
					userId,
					key,
					requestHash: `hash-${i}`,
				});
				if (start.kind !== "started") throw new Error(start.kind);
				await completeIdempotentRequest(db, start.id, 201, {
					name: `Body ${i}`,
				});
			}
			const [a, b] = [await stored(keys[0]), await stored(keys[1])];
			const put = (atA: string, atB: string) =>
				adminDb.$executeRaw`UPDATE "idempotency_key" SET "responseBody" =
				CASE "id" WHEN ${a.id} THEN ${atA}::jsonb ELSE ${atB}::jsonb END
				WHERE "id" IN (${a.id}, ${b.id})`;
			await put(b.text, a.text);
			for (const [i, key] of keys.entries())
				await expect(
					startIdempotentRequest(db, { userId, key, requestHash: `hash-${i}` }),
				).rejects.toMatchObject({ code: "auth_failed" });
			await put(a.text, b.text);
			const replay = await startIdempotentRequest(db, {
				userId,
				key: keys[1],
				requestHash: "hash-1",
			});
			expect(replay).toEqual({
				kind: "replay",
				status: 201,
				body: { name: "Body 1" },
			});
		},
	);
});

describe("a client Idempotency-Key with a server prefix", () => {
	it.each([
		`undo-stash:${randomUUID()}`,
		`undo-icon:${randomUUID()}:accounts/forged.webp`,
	])("is refused before anything is stored (%s)", async (key) => {
		const body = {
			id: randomUUID(),
			name: "Forged",
			type: "CASH",
			currency: "ARS",
			balance: "1",
		};
		await expectProblem(await send("/accounts", body, key), 400, "bad_request");
		await expect(
			adminDb.idempotencyKey.count({ where: { userId, key } }),
		).resolves.toBe(0);
		await expect(
			adminDb.assetAccount.count({ where: { id: body.id } }),
		).resolves.toBe(0);
	});
});
