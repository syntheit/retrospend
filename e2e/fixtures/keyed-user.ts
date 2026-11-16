/**
 * One account that has Advanced protection keys, for the flows that sign in
 * through prelogin and Argon2id. It is written straight to Postgres like the
 * personas, but it is not one of them (no ledger, not in SEED_USERS), so the
 * seeded counts the other flows read do not change.
 *
 * The stored password hash is the one of the sign-in secret, made here from
 * the typed password with the app's own derivation at the Argon2 floor, so a
 * sign-in takes a fraction of a second. All values are fake.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "~prisma";
// Deep paths: the package index also loads the known-answer self-test, whose
// JSON import Playwright's loader refuses.
import { toBase64Url } from "../../packages/crypto/src/base64url";
import {
	ARGON2_FLOOR,
	deriveMasterKey,
	masterSubkeys,
} from "../../packages/crypto/src/keys";
import { signInSecret } from "../../packages/crypto/src/sign-in-secret";
import { createWebPrimitives } from "../../packages/crypto/src/web";
import { assertE2eDatabase } from "../db-guard";

export const KEYED_USER = {
	id: "e2e_user_keyed",
	name: "Keyed E2E User",
	username: "keyede2e",
	email: "keyed.e2e@example.com",
	password: "Keyed-e2e-2026!",
} as const;

const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xe0 + i);

/** What prelogin must answer for the keyed account. */
export const KEYED_KDF = {
	salt: toBase64Url(SALT),
	memoryKiB: ARGON2_FLOOR.memoryKiB,
	passes: ARGON2_FLOOR.passes,
} as const;

/** The text sign-in must send as the password for the keyed account. */
export async function keyedSignInSecret(): Promise<string> {
	const p = await createWebPrimitives();
	const master = deriveMasterKey(p, KEYED_USER.password, SALT, ARGON2_FLOOR);
	return signInSecret(masterSubkeys(p, master).authKey);
}

export async function seedKeyedUser(databaseUrl: string): Promise<void> {
	assertE2eDatabase(databaseUrl);
	const secret = await keyedSignInSecret();
	const db = new PrismaClient({
		adapter: new PrismaPg({ connectionString: databaseUrl }),
	});
	try {
		await db.user.create({
			data: {
				id: KEYED_USER.id,
				name: KEYED_USER.name,
				username: KEYED_USER.username,
				email: KEYED_USER.email,
				emailVerified: true,
			},
		});
		await db.account.create({
			data: {
				id: "e2e_account_keyed",
				accountId: KEYED_USER.id,
				providerId: "credential",
				userId: KEYED_USER.id,
				password: await hashPassword(secret),
			},
		});
		await db.protectionKeySet.create({
			data: {
				userId: KEYED_USER.id,
				kdfSalt: SALT,
				kdfMemoryKiB: ARGON2_FLOOR.memoryKiB,
				kdfPasses: ARGON2_FLOOR.passes,
				publicKey: new Uint8Array(32).fill(7),
			},
		});
	} finally {
		await db.$disconnect();
	}
}
