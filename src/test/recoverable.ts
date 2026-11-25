/**
 * An account the way enable leaves it, with a live reset link: one write makes
 * the key set, the recovery hash and the wraps (the key before the proof it
 * checks), the stored account hash is the hash of a sign-in secret, and the
 * link comes from the real token service. Shared by the recovery service test
 * and the recovery route test, so the two stand on the same account.
 * Sign-up sends its own verification mail: a test that counts mail clears it.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Recover } from "@retrospend/api-contract";
import {
	type Primitives,
	signInSecret,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { wrapKeyToPublic } from "@retrospend/crypto/k4";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { hashPassword } from "better-auth/crypto";
import { auth } from "~/server/better-auth";
import { applyKeyChanges } from "~/server/services/protection-keys/protection-keys.service";
import { hashRecoveryProof } from "~/server/services/protection-keys/validate";
import { adminDb } from "~/test/pg-harness";
import { issueLinkFor } from "~/test/reset-links";

export const PASSWORD = "Correct horse 1";

let primitives: Promise<Primitives> | undefined;
export const loadPrimitives = (): Promise<Primitives> =>
	// biome-ignore lint/suspicious/noAssignInExpressions: memoized once per worker
	(primitives ??= createWebPrimitives());

export async function passwordUser() {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	await adminDb.user.update({
		where: { id: user.id },
		data: { emailVerified: true },
	});
	// Sign-up signed the person in; a test counts only the sessions it makes.
	await adminDb.session.deleteMany({ where: { userId: user.id } });
	return { id: user.id, email };
}

/**
 * Wraps to a public key, that no flow makes yet, are seeded to prove they never
 * leave through any route.
 */
export async function recoverable(opts: { state?: "OFF" | "ON" } = {}) {
	const p = await loadPrimitives();
	const symmetric = (
		role: "ak-password" | "ak-recovery" | "private-key",
		userId: string,
	) => ({
		role,
		targetId: userId,
		wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
	});
	const user = await passwordUser();
	const userId = user.id;
	const authKeyText = signInSecret(p.randomBytes(32));
	const recoveryAuthKey = signInSecret(p.randomBytes(32));
	const wraps = [
		symmetric("ak-password", userId),
		symmetric("ak-recovery", userId),
		symmetric("private-key", userId),
	];
	const publicKey = p.boxKeypair().publicKey;
	await adminDb.$transaction((tx) =>
		applyKeyChanges(
			tx,
			userId,
			{
				baseVersion: 0,
				set: {
					kdfSalt: p.randomBytes(16),
					kdfMemoryKiB: 65536,
					kdfPasses: 3,
					publicKey,
				},
				recoveryHash: hashRecoveryProof(recoveryAuthKey),
				put: wraps,
				remove: [],
			},
			"enable",
		),
	);
	const collectionId = randomBytes(16).toString("hex");
	const extra = [
		{
			role: "collection-key" as const,
			targetId: collectionId,
			wrapped: wrapKey(
				p,
				p.randomBytes(32),
				"collection-key",
				collectionId,
				p.randomBytes(32),
			),
		},
		{
			role: "ak-device" as const,
			targetId: "device-1",
			wrapped: wrapKeyToPublic(
				p,
				p.boxKeypair().publicKey,
				"ak-device",
				"device-1",
				p.randomBytes(32),
			),
		},
	];
	await adminDb.protectionKeyWrap.createMany({
		data: extra.map((w) => ({
			userId,
			role: w.role,
			targetId: w.targetId,
			wrapped: Uint8Array.from(w.wrapped),
		})),
	});
	await adminDb.account.updateMany({
		where: { userId, providerId: "credential" },
		data: { password: await hashPassword(authKeyText) },
	});
	if (opts.state === "ON")
		await adminDb.user.update({
			where: { id: userId },
			data: { protectionState: "ON" },
		});
	const token = await issueLinkFor(userId);
	return {
		...user,
		authKeyText,
		recoveryAuthKey,
		wraps: [...wraps, ...extra],
		publicKey,
		token,
	};
}
export type Recoverable = Awaited<ReturnType<typeof recoverable>>;

/** What the device sends after it unwrapped with the recovery key and rewrapped. */
export function commitBody(
	p: Primitives,
	k: Recoverable,
	over: Partial<Recover> = {},
) {
	const newAuthKey = signInSecret(p.randomBytes(32));
	const wrapped = wrapKey(
		p,
		p.randomBytes(32),
		"ak-password",
		k.id,
		p.randomBytes(32),
	);
	const salt = p.randomBytes(16);
	return {
		newAuthKey,
		wrapped,
		salt,
		input: {
			token: k.token,
			recoveryAuthKey: k.recoveryAuthKey,
			newAuthKey,
			kdf: { salt: toBase64Url(salt), memoryKiB: 65536, passes: 3 },
			wrappedAccountKey: toBase64Url(wrapped),
			baseVersion: 1,
			...over,
		} satisfies Recover,
	};
}

export const sha256 = (text: string) =>
	createHash("sha256").update(text).digest("hex");

export const storedHash = async (userId: string): Promise<string> => {
	const row = await adminDb.account.findFirstOrThrow({
		where: { userId, providerId: "credential" },
	});
	if (!row.password) throw new Error("the account has no password hash");
	return row.password;
};
export const wrapBytes = async (userId: string, role: string) =>
	toBase64Url(
		(
			await adminDb.protectionKeyWrap.findFirstOrThrow({
				where: { userId, role },
			})
		).wrapped,
	);
export const triesSpent = async (tokenHash: string) =>
	(
		await adminDb.apiRateLimit.findUnique({
			where: { key: `recovery:token:${tokenHash}` },
		})
	)?.count ?? 0;

export async function seedApiKey(userId: string) {
	const id = randomUUID();
	await adminDb.apikey.create({
		data: {
			id,
			key: sha256(id),
			referenceId: userId,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});
	return id;
}

/** The wraps and parameters as they are, to prove a refusal left them alone. */
export async function snapshot(userId: string) {
	const set = await adminDb.protectionKeySet.findUniqueOrThrow({
		where: { userId },
	});
	const wraps = await adminDb.protectionKeyWrap.findMany({
		where: { userId },
		orderBy: [{ role: "asc" }, { targetId: "asc" }],
	});
	return JSON.stringify({
		hash: await storedHash(userId),
		version: set.version,
		salt: toBase64Url(set.kdfSalt),
		recoveryHash: Buffer.from(set.recoveryHash ?? []).toString("hex"),
		wraps: wraps.map((w) => [w.role, w.targetId, toBase64Url(w.wrapped)]),
		sessions: await adminDb.session.count({ where: { userId } }),
		tokens: await adminDb.passwordResetToken.count({ where: { userId } }),
		apiKeys: await adminDb.apikey.count({ where: { referenceId: userId } }),
	});
}
