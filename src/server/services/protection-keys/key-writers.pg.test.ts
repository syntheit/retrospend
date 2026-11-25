/**
 * Who may write a key set, and what each writer may write (validate.ts
 * KEY_WRITERS). The writer list is a closed union so that a new caller of
 * applyKeyChanges has to name itself; this file holds the plan's table of
 * writers (docs/roadmap/e2ee-k1-k3.md, critic 6) as a literal, one case per
 * member (a `Record`, so a member added to the union without a case fails
 * typecheck), and runs the rules each one is held to on real Postgres.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Primitives, toBase64Url, wrapKey } from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { REPO_ROOT } from "~/test/uiRules/paths";
import {
	applyKeyChanges,
	type KeyChanges,
	type KeyWriter,
	ProtectionKeysError,
	type WrapInput,
} from "./protection-keys.service";
import { hashRecoveryProof, KEY_WRITERS } from "./validate";

/** The plan's writer table, written out: not read from the code it checks. */
const PLAN_WRITERS = ["enable", "rotate", "recovery", "newRecoveryKey"];

/**
 * What each writer may do, hand-derived from the plan: the turn-on creates the
 * set and writes the recovery proof; a password change and a recovery leave the
 * proof alone; Make new key replaces the recovery wrap and the proof together.
 */
const EXPECTED: Record<KeyWriter, { creates: boolean; proof: boolean }> = {
	enable: { creates: true, proof: true },
	rotate: { creates: false, proof: false },
	recovery: { creates: false, proof: false },
	newRecoveryKey: { creates: false, proof: true },
};

/**
 * Where each writer is driven through its own caller: the pg test file that
 * runs it through its route (the recovery commit through its service, whose
 * route test is in api/v1/auth).
 */
const DRIVEN_BY: Record<KeyWriter, { file: string }> = {
	enable: { file: "src/server/services/protection-keys/enable.pg.test.ts" },
	rotate: { file: "src/server/services/protection-keys/rotate.pg.test.ts" },
	recovery: { file: "src/server/services/protection-keys/recover.pg.test.ts" },
	newRecoveryKey: {
		file: "src/server/services/protection-keys/new-recovery-key.pg.test.ts",
	},
};

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

const wrap = (
	role: "ak-password" | "ak-recovery",
	userId: string,
): WrapInput => ({
	role,
	targetId: userId,
	wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
});
const proofHash = () => hashRecoveryProof(toBase64Url(p.randomBytes(32)));
const baseSet = () => ({
	kdfSalt: p.randomBytes(16),
	kdfMemoryKiB: 64 * 1024,
	kdfPasses: 3,
	publicKey: p.boxKeypair().publicKey,
});
const created = (userId: string): KeyChanges => ({
	baseVersion: 0,
	set: baseSet(),
	recoveryHash: proofHash(),
	put: [wrap("ak-password", userId), wrap("ak-recovery", userId)],
	remove: [],
});

async function keyed() {
	const { user } = await createTestUser();
	await adminDb.$transaction((tx) =>
		applyKeyChanges(tx, user.id, created(user.id), "enable"),
	);
	return user.id;
}
const attempt = (userId: string, changes: KeyChanges, writer: KeyWriter) =>
	adminDb
		.$transaction((tx) => applyKeyChanges(tx, userId, changes, writer))
		.then(
			() => "ok",
			(e) => (e instanceof ProtectionKeysError ? e.code : String(e)),
		);
const storedHash = async (userId: string) =>
	Buffer.from(
		(await adminDb.protectionKeySet.findUniqueOrThrow({ where: { userId } }))
			.recoveryHash ?? [],
	).toString("hex");

describe("the writer union", () => {
	it("is the plan's writer table, and every member has its rules and its route test", () => {
		expect([...KEY_WRITERS].sort()).toEqual([...PLAN_WRITERS].sort());
		expect(Object.keys(EXPECTED).sort()).toEqual([...PLAN_WRITERS].sort());
		expect(Object.keys(DRIVEN_BY).sort()).toEqual([...PLAN_WRITERS].sort());
		for (const driven of Object.values(DRIVEN_BY))
			expect(existsSync(join(REPO_ROOT, driven.file)), driven.file).toBe(true);
	});
});

describe.each(KEY_WRITERS)("writer %s", (writer) => {
	const rule = EXPECTED[writer];

	it(`${rule.creates ? "creates" : "does not create"} a set`, async () => {
		const { user } = await createTestUser();
		const id = user.id;
		const change: KeyChanges = {
			...created(id),
			recoveryHash: rule.proof ? proofHash() : undefined,
			put: rule.proof
				? [wrap("ak-password", id), wrap("ak-recovery", id)]
				: [wrap("ak-password", id)],
		};
		expect(await attempt(id, change, writer)).toBe(
			rule.creates ? "ok" : "invalid_input",
		);
		const sets = await adminDb.protectionKeySet.count({
			where: { userId: id },
		});
		expect(sets).toBe(rule.creates ? 1 : 0);
	});

	it(`${rule.creates ? "does not update" : "updates"} a set`, async () => {
		const id = await keyed();
		const before = await storedHash(id);
		const change: KeyChanges = rule.proof
			? {
					baseVersion: 1,
					recoveryHash: proofHash(),
					put: [wrap("ak-recovery", id)],
					remove: [],
				}
			: { baseVersion: 1, put: [wrap("ak-password", id)], remove: [] };
		expect(await attempt(id, change, writer)).toBe(
			rule.creates ? "invalid_input" : "ok",
		);
		if (rule.creates) return;
		const after = await storedHash(id);
		// The proof moves exactly when the writer writes one.
		expect(after === before).toBe(!rule.proof);
		if (rule.proof)
			expect(after).toBe(
				Buffer.from(change.recoveryHash ?? []).toString("hex"),
			);
	});

	it("refuses a proof without the recovery wrap, a recovery wrap without the proof, and dropping the wrap", async () => {
		const id = await keyed();
		const before = await storedHash(id);
		const version = writer === "enable" ? 0 : 1;
		const target = writer === "enable" ? (await createTestUser()).user.id : id;
		const set = version === 0 ? { set: baseSet() } : {};
		const refused: KeyChanges[] = [
			{
				baseVersion: version,
				...set,
				recoveryHash: proofHash(),
				put: [wrap("ak-password", target)],
				remove: [],
			},
			{
				baseVersion: version,
				...set,
				put: [wrap("ak-recovery", target)],
				remove: [],
			},
			{
				baseVersion: version,
				...set,
				put: [wrap("ak-password", target)],
				remove: [{ role: "ak-recovery", targetId: target }],
			},
			{
				baseVersion: version,
				...set,
				recoveryHash: new Uint8Array(31),
				put: [wrap("ak-recovery", target)],
				remove: [],
			},
		];
		for (const change of refused)
			expect(await attempt(target, change, writer)).toBe("invalid_input");
		expect(await storedHash(id)).toBe(before);
	});
});
