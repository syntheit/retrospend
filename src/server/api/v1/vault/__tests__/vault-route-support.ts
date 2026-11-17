/**
 * Fixtures for the /vault route tests: an account with a protection key set,
 * the wire form of a write made from real sealed bytes, and calls through the
 * v1 handler. Sessions come from the shared v1 harness.
 */
import { randomBytes } from "node:crypto";
import { contract, type VaultWriteDto } from "@retrospend/api-contract";
import type { VaultWrite } from "~/server/services/vault/validate";
import { wrapFixtureKey } from "~/server/services/vault/vault-db-support";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	webCookieFor,
} from "../../core/__tests__/harness";

export { adminDb, call, expectBody };

/** A request address nobody else uses, so the per-IP limit is never shared. */
export const ipFor = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });

const created: string[] = [];

/** A user with a protection key set, as turning protection on leaves one. */
export async function accountWithKeys() {
	const { user } = await createTestUser();
	created.push(user.id);
	await adminDb.protectionKeySet.create({
		data: {
			userId: user.id,
			kdfSalt: randomBytes(16),
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: randomBytes(32),
		},
	});
	await wrapFixtureKey(user.id);
	return user.id;
}

/** A user with no key set. */
export async function accountWithoutKeys() {
	const { user } = await createTestUser();
	created.push(user.id);
	return user.id;
}

/** Removes what the vault tests left: the table and the key tables must be empty for the rollback tests. */
export async function cleanUpVaultTests() {
	await adminDb.$executeRaw`DELETE FROM "vault_record" WHERE "userId" = ANY(${created})`;
	await adminDb.protectionKeyWrap.deleteMany({
		where: { userId: { in: created } },
	});
	await adminDb.protectionKeySet.deleteMany({
		where: { userId: { in: created } },
	});
	await adminDb.$executeRaw`DELETE FROM "api_rate_limit" WHERE "key" LIKE 'vault-writes:%'`;
}

/** The base64url text a client sends for sealed bytes. */
export const textOf = (bytes: Uint8Array) =>
	Buffer.from(bytes).toString("base64url");

/** A service-side write as the wire carries it. */
export function toWire(w: VaultWrite): VaultWriteDto {
	return {
		...w,
		ciphertext: w.ciphertext === null ? null : textOf(w.ciphertext),
	};
}

export type WireRecord = {
	id: string;
	collectionId: string;
	entity: number;
	version: number;
	ciphertext: string | null;
	deletedAt: string | null;
};
export type Page = { records: WireRecord[]; cursor: string; hasMore: boolean };

export const webHeaders = async (userId: string, ip: number) => ({
	...ipFor(ip),
	...(await webCookieFor(userId)),
});
export const mobileHeaders = async (userId: string, ip: number) => ({
	...ipFor(ip),
	...(await asMobile(userId)),
});

export const post = (
	headers: Record<string, string>,
	writes: VaultWriteDto[],
	idempotent: boolean | string = true,
) =>
	call("/vault/writes", {
		method: "POST",
		headers,
		body: { writes },
		idempotent,
	});

export const pullRaw = (headers: Record<string, string>, query = "") =>
	call(`/vault/changes${query}`, { headers });

export const pull = async (headers: Record<string, string>, query = "") =>
	expectBody<Page>(await pullRaw(headers, query), contract.vault.changes);
