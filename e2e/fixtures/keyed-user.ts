/**
 * One account that has Advanced protection keys, for the flows that sign in
 * through prelogin and Argon2id. It is written straight to Postgres like the
 * personas, but it is not one of them (no ledger, not in SEED_USERS), so the
 * seeded counts the other flows read do not change. Three more are used up by
 * one flow each: one changes its password (keyed-password-change.spec.ts), one
 * recovers with its recovery key (protection-recover.spec.ts) and one makes a
 * new recovery key (protection-new-key.spec.ts), so no other flow may sign in
 * as them.
 *
 * The stored password hash is the one of the sign-in secret, made here from
 * the typed password with the app's own derivation at the Argon2 floor, so a
 * sign-in takes a fraction of a second. All values are fake.
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "~prisma";
// Deep paths: the package index also loads the known-answer self-test, whose
// JSON import Playwright's loader refuses.
import { toBase64Url } from "../../packages/crypto/src/base64url";
import {
	ARGON2_FLOOR,
	deriveMasterKey,
	encodeRecoveryKey,
	masterSubkeys,
	recoverySubkeys,
	wrapKey,
} from "../../packages/crypto/src/keys";
import { signInSecret } from "../../packages/crypto/src/sign-in-secret";
import { createWebPrimitives } from "../../packages/crypto/src/web";
import { E2E_DATABASE_URL } from "../constants";
import { assertE2eDatabase } from "../db-guard";

export const KEYED_USER = {
	name: "Keyed E2E User",
	username: "keyede2e",
	email: "keyed.e2e@example.com",
	password: "Keyed-e2e-2026!",
} as const;

/** The keyed account that changes its password; the new one is what it signs in with after. */
export const KEYED_ROTATE_USER = {
	name: "Keyed Rotate E2E User",
	username: "keyedrotate",
	email: "keyed.rotate.e2e@example.com",
	password: "Keyed-rotate-2026!",
	newPassword: "Changed-rotate-2027?",
} as const;

/** The keyed account that recovers with its recovery key (protection-recover.spec.ts); the new password is what it signs in with after. */
export const KEYED_RECOVER_USER = {
	name: "Keyed Recover E2E User",
	username: "keyedrecover",
	email: "keyed.recover.e2e@example.com",
	password: "Keyed-recover-2026!",
	newPassword: "Recovered-e2e-2027?",
} as const;

/** The keyed account that makes a new recovery key (protection-new-key.spec.ts); its password does not change. */
export const KEYED_NEWKEY_USER = {
	name: "Keyed New Key E2E User",
	username: "keyednewkey",
	email: "keyed.newkey.e2e@example.com",
	password: "Keyed-newkey-2026!",
} as const;

/** The recovery key of every keyed fixture account (all values are fake), as the person would write it down. */
const RECOVERY_KEY = Uint8Array.from({ length: 32 }, (_, i) => 0x90 + i);
export const KEYED_RECOVERY_KEY_TEXT = encodeRecoveryKey(RECOVERY_KEY);

type Account = {
	name: string;
	username: string;
	email: string;
	password: string;
};

const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xe0 + i);
const ROTATE_SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xd0 + i);
const RECOVER_SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xc0 + i);
const NEWKEY_SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xb0 + i);

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

/**
 * Signs an account up through the app with the derived secret as its
 * password (so the server stores the hash and, in a sealed run, seals the
 * name like every other sign-up), then adds its key set and the account key
 * wrapped under its password on the owner connection, which is what makes
 * prelogin answer with the parameters and a password change find a wrap.
 * It is made the way enable makes it (the order of production): one account
 * key, wrapped under the password and under the recovery key, a real key pair
 * whose private half is wrapped under the account key, and the SHA-256 of the
 * recovery auth key stored with the set, so a recovery flow can run on it.
 */
async function seedKeyedAccount(
	databaseUrl: string,
	account: Account,
	salt: Uint8Array,
	signUp: SignUp,
): Promise<void> {
	const p = await createWebPrimitives();
	const { authKey, wrapKey: passwordWrapKey } = masterSubkeys(
		p,
		deriveMasterKey(p, account.password, salt, ARGON2_FLOOR),
	);
	await signUp(
		account.email,
		signInSecret(authKey),
		account.name,
		account.username,
	);
	const db = new PrismaClient({
		adapter: new PrismaPg({ connectionString: databaseUrl }),
	});
	try {
		const user = await db.user.findUniqueOrThrow({
			where: { email: account.email },
			select: { id: true },
		});
		const accountKey = p.randomBytes(32);
		const pair = p.boxKeypair();
		const recovery = recoverySubkeys(p, RECOVERY_KEY);
		const wrap = (
			wrappingKey: Uint8Array,
			role: "ak-password" | "ak-recovery" | "private-key",
			key: Uint8Array,
		) => ({
			userId: user.id,
			role,
			targetId: user.id,
			wrapped: Uint8Array.from(wrapKey(p, wrappingKey, role, user.id, key)),
		});
		await db.protectionKeySet.create({
			data: {
				userId: user.id,
				kdfSalt: Uint8Array.from(salt),
				kdfMemoryKiB: ARGON2_FLOOR.memoryKiB,
				kdfPasses: ARGON2_FLOOR.passes,
				publicKey: Uint8Array.from(pair.publicKey),
				recoveryHash: Uint8Array.from(
					createHash("sha256").update(recovery.authKey).digest(),
				),
			},
		});
		await db.protectionKeyWrap.createMany({
			data: [
				wrap(passwordWrapKey, "ak-password", accountKey),
				wrap(recovery.wrapKey, "ak-recovery", accountKey),
				wrap(accountKey, "private-key", pair.privateKey),
			],
		});
	} finally {
		await db.$disconnect();
	}
}

type SignUp = (
	email: string,
	password: string,
	name: string,
	username: string,
) => Promise<void>;

/** Seeds the keyed accounts (see the header). */
export async function seedKeyedUser(
	databaseUrl: string,
	signUp: SignUp,
): Promise<void> {
	assertE2eDatabase(databaseUrl);
	await seedKeyedAccount(databaseUrl, KEYED_USER, SALT, signUp);
	await seedKeyedAccount(databaseUrl, KEYED_ROTATE_USER, ROTATE_SALT, signUp);
	await seedKeyedAccount(databaseUrl, KEYED_RECOVER_USER, RECOVER_SALT, signUp);
	await seedKeyedAccount(databaseUrl, KEYED_NEWKEY_USER, NEWKEY_SALT, signUp);
}

/**
 * A password reset link for one account, written straight to Postgres. The e2e
 * app has no mail, so the email that carries the link cannot be read; this
 * stores what the app stores (the SHA-256 of the token, the user, the origin,
 * an hour to live) and hands back the raw token for the page's URL.
 */
export async function issueResetLink(
	email: string,
	origin: "email" | "admin" = "email",
): Promise<string> {
	assertE2eDatabase(E2E_DATABASE_URL);
	const token = randomBytes(32).toString("hex");
	const db = new PrismaClient({
		adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
	});
	try {
		const user = await db.user.findUniqueOrThrow({
			where: { email },
			select: { id: true },
		});
		await db.passwordResetToken.create({
			data: {
				token: createHash("sha256").update(token).digest("hex"),
				userId: user.id,
				origin,
				expires: new Date(Date.now() + 60 * 60 * 1000),
			},
		});
	} finally {
		await db.$disconnect();
	}
	return token;
}
