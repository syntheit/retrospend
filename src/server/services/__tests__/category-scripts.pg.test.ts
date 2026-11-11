/**
 * The two default-category scripts write as the owning user, each name with
 * its index (E2EE D11 PR 4.1, plan section 1 item 2). Hand-derived, for a user
 * with the old defaults "Dining Out" and "Gas" (no "Transport"):
 *
 *   migrate          -> "Dining Out" renamed "Restaurants"; "Gas" merged into a new
 *                       "Transport"; "Clothing", "Entertainment", "Gifts" added:
 *                       those five rows carry a current-tag index
 *   migrate again    -> nothing to do, rows unchanged
 *   sync             -> every default name, indexed; again: 0 more, rows unchanged
 *   sealing on       -> the same, and the user's key exists (made before the transaction)
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { blindIndexTag } from "~/server/crypto/blind-index";
import type { Keyring } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { newMasterKeyring, userKeyring } from "~/test/sealed-fixture";
import { migrateUserCategories } from "../../../../scripts/migrate-default-categories";
import { syncUserCategories } from "../../../../scripts/sync-default-categories";
import { CATEGORY_NAME_INDEX_LABEL } from "../category-name-index.service";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

beforeAll(() => {
	master.ring = newMasterKeyring();
});
afterEach(() => setSealingForTests());

const rowsOf = (userId: string) =>
	adminDb.category.findMany({
		where: { userId },
		select: { id: true, name: true, color: true, nameIndex: true },
		orderBy: { name: "asc" },
	});

const keyCount = async (userId: string) => {
	const [row] = await adminDb.$queryRaw<{ n: bigint }[]>`
		SELECT count(*) AS n FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
	return Number(row?.n);
};

const tagOf = async (userId: string) =>
	blindIndexTag(
		await userKeyring(userId, master.ring as Keyring),
		CATEGORY_NAME_INDEX_LABEL,
	);

describe("scripts/migrate-default-categories.ts, beyond the user's own rows", () => {
	it("moves a shared expense the user can no longer see to the merged category", async () => {
		const [{ user: ana }, { user: beto }] = [
			await createTestUser(),
			await createTestUser(),
		];
		const gas = await adminDb.category.create({
			data: { userId: ana.id, name: "Gas", color: "slate" },
		});
		// Ana filed it, then left the project: RLS hides it from her now.
		const trip = await adminDb.project.create({
			data: { name: "Trip", createdById: beto.id, primaryCurrency: "ARS" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: trip.id,
				participantType: "user",
				participantId: beto.id,
				role: "ORGANIZER",
			},
		});
		const fuel = await adminDb.sharedTransaction.create({
			data: {
				description: "Nafta",
				amount: "30000",
				currency: "ARS",
				date: new Date("2026-10-08"),
				paidByType: "user",
				paidById: beto.id,
				createdByType: "user",
				createdById: beto.id,
				projectId: trip.id,
				categoryId: gas.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: beto.id,
							shareAmount: "30000",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});

		await migrateUserCategories(ana.id, false);
		const transport = await adminDb.category.findFirstOrThrow({
			where: { userId: ana.id, name: "Transport" },
		});
		expect(
			(
				await adminDb.sharedTransaction.findUniqueOrThrow({
					where: { id: fuel.id },
				})
			).categoryId,
		).toBe(transport.id);
	});

	it("as a dry run writes nothing and makes no key, sealing on", async () => {
		setSealingForTests(() => true);
		const { user } = await createTestUser();
		await adminDb.category.create({
			data: { userId: user.id, name: "Dining Out", color: "orange" },
		});
		const before = await rowsOf(user.id);
		expect(await migrateUserCategories(user.id, true)).toMatchObject({
			renames: ["Dining Out → Restaurants"],
			additions: ["Clothing", "Entertainment", "Gifts"],
		});
		expect(await rowsOf(user.id)).toEqual(before);
		expect(await keyCount(user.id)).toBe(0);
	});
});

for (const sealingOn of [false, true]) {
	const label = sealingOn ? "sealing on" : "sealing off";

	describe(`scripts/migrate-default-categories.ts (${label})`, () => {
		it("renames, merges and adds with an index, and a second run changes nothing", async () => {
			setSealingForTests(() => sealingOn);
			const { user } = await createTestUser();
			await adminDb.category.createMany({
				data: [
					{ userId: user.id, name: "Dining Out", color: "orange" },
					{ userId: user.id, name: "Gas", color: "slate" },
				],
			});

			const actions = await migrateUserCategories(user.id);
			expect(actions).toMatchObject({
				renames: ["Dining Out → Restaurants"],
				merges: ["Gas → Transport"],
				additions: ["Clothing", "Entertainment", "Gifts"],
			});
			if (sealingOn) expect(await keyCount(user.id)).toBe(1);
			const rows = await rowsOf(user.id);
			expect(rows.map((r) => r.name)).toEqual([
				"Clothing",
				"Entertainment",
				"Gifts",
				"Restaurants",
				"Transport",
			]);
			const tag = await tagOf(user.id);
			expect(rows.every((r) => r.nameIndex?.startsWith(`${tag}:`))).toBe(true);

			expect(await migrateUserCategories(user.id)).toEqual({
				renames: [],
				renameMerges: [],
				merges: [],
				additions: [],
				colorFixes: [],
			});
			expect(await rowsOf(user.id)).toEqual(rows);
		});
	});

	describe(`scripts/sync-default-categories.ts (${label})`, () => {
		it("adds every default name with an index, once", async () => {
			setSealingForTests(() => sealingOn);
			const { user } = await createTestUser();
			expect(await syncUserCategories(user.id)).toBe(DEFAULT_CATEGORIES.length);
			if (sealingOn) expect(await keyCount(user.id)).toBe(1);
			const rows = await rowsOf(user.id);
			expect(rows.map((r) => r.name).sort()).toEqual(
				DEFAULT_CATEGORIES.map((c) => c.name).sort(),
			);
			const tag = await tagOf(user.id);
			expect(rows.every((r) => r.nameIndex?.startsWith(`${tag}:`))).toBe(true);

			expect(await syncUserCategories(user.id)).toBe(0);
			expect(await rowsOf(user.id)).toEqual(rows);
		});
	});
}
