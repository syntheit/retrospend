/**
 * A preview with a master key configured (E2EE D11 PR 3.1): the real runner
 * transaction (userTransactionRunner, on the app's db) loads the user's keys
 * and the instance keys read-only, on their own connection, before the
 * preview opens, and mints nothing. The mutation recolors a category, so the
 * D9 name index (which may mint on a category create) is not involved.
 * Hand-derived expectations:
 *
 *   cold preview   -> two keystore loads (user, instance), both done before the mutation runs;
 *                     no user key, no instance key and no instance marker afterward
 *   second preview -> no keystore load (cached)
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keyring } from "~/server/crypto/field-crypto";
import { keystoreDb } from "~/server/db-core";
import {
	createFiguresRegistry,
	type FigureDb,
} from "~/server/figures/registry";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { userTransactionRunner } from "./index";
import { createPreviewRunner } from "./runner";
import type { MoneyMutation } from "./types";

vi.mock("~/server/crypto/master-key", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/server/crypto/master-key")>();
	const testMaster = new Keyring([{ id: 1, key: randomBytes(32) }]);
	return { ...actual, getMasterKeyring: () => testMaster };
});

const events: string[] = [];

const recolor: MoneyMutation<{ id: string }, null> = {
	id: "test.recolorCategory",
	touches: [],
	run: async (tx, input) => {
		events.push("mutation");
		await tx.category.update({
			where: { id: input.id },
			data: { color: "red" },
		});
		return {
			value: null,
			undo: {
				kind: "revert",
				mutation: "test.recolorCategory",
				rows: [{ table: "category", id: input.id }],
			},
		};
	},
};

beforeEach(async () => {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
	events.length = 0;
	const original = keystoreDb.$transaction;
	vi.spyOn(keystoreDb, "$transaction").mockImplementation(((
		...args: unknown[]
	) => {
		events.push("keystore begin");
		return (original as (...a: unknown[]) => Promise<unknown>)(...args).finally(
			() => events.push("keystore end"),
		);
	}) as typeof original);
});
afterEach(() => vi.restoreAllMocks());

describe("a preview with a master key", () => {
	it("loads keys read-only before it opens, and mints nothing", async () => {
		const me = await createTestUser();
		const category = await adminDb.category.create({
			data: { userId: me.user.id, name: `Seed ${randomUUID()}`, color: "blue" },
		});
		const runner = createPreviewRunner({
			figures: createFiguresRegistry<FigureDb>([]),
			actor: { userId: me.user.id },
			transaction: userTransactionRunner(me.user.id),
		});

		await runner.preview(recolor, { id: category.id });

		expect(events).toEqual([
			"keystore begin",
			"keystore begin",
			"keystore end",
			"keystore end",
			"mutation",
		]);
		const [left] = await adminDb.$queryRaw<
			{
				userKeys: bigint;
				instanceKeys: bigint;
				since: Date | null;
				color: string;
			}[]
		>`
			SELECT (SELECT count(*) FROM keystore."user_data_key" WHERE "userId" = ${me.user.id}) AS "userKeys",
			       (SELECT count(*) FROM keystore."instance_text_key") AS "instanceKeys",
			       (SELECT "instanceKeySince" FROM "app_settings"
			         WHERE "id" = 'app_settings_singleton') AS "since",
			       (SELECT "color" FROM "category" WHERE "id" = ${category.id}) AS "color"`;
		expect(left).toEqual({
			userKeys: 0n,
			instanceKeys: 0n,
			since: null,
			color: "blue",
		});

		events.length = 0;
		await runner.preview(recolor, { id: category.id });
		expect(events).toEqual(["mutation"]);
	});
});
