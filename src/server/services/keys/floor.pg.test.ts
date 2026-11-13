/**
 * The sealing floor and the start gates (E2EE D11 PR 9.1, plan
 * docs/roadmap/e2ee-d11-pr9.md section 3 and its critic rounds). Each case
 * runs in a rolled-back transaction on the owner connection, so a floor, an
 * epoch or a deleted key never reaches the next file in this worker's
 * database. The instance key and the test user's key are made once, outside
 * the transactions: the mint writes app_settings on its own connection, which
 * would wait on their row lock. `boot` runs the checks in the order
 * instrumentation.ts runs them.
 */
import { randomBytes } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { resetEpochForTests } from "~/server/crypto/epoch";
import { Keyring } from "~/server/crypto/field-crypto";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackPrismaTransaction } from "~/test/rolled-back-sql";
import {
	instanceKeyring,
	resetInstanceKey,
	userKeyring,
} from "~/test/sealed-fixture";
import type { Prisma } from "~prisma";
import {
	assertFieldEncryptionStart,
	type FieldEncryptionStartOptions,
} from "./field-encryption-start";
import { assertStartGates, raiseSealingFloor, StartGateError } from "./floor";

const master = new Keyring([{ id: 1, key: randomBytes(32) }]);
type Tx = Prisma.TransactionClient;

type Settings = {
	floor: number | null;
	epoch: boolean;
	marker: boolean;
};
const settings = async (tx: Tx) => {
	const [row] = await tx.$queryRaw<Settings[]>`
		SELECT "sealingFloor" AS "floor", "fieldEncryptionSince" IS NOT NULL AS "epoch",
		       "instanceKeySince" IS NOT NULL AS "marker"
		FROM "app_settings" WHERE "id" = 'app_settings_singleton'`;
	return row;
};
const indexAll = (tx: Tx) =>
	tx.$executeRaw`UPDATE "category" SET "nameIndex" = 'test-' || "id" WHERE "nameIndex" IS NULL`;
const setEpoch = (tx: Tx) =>
	tx.$executeRaw`UPDATE "app_settings" SET "fieldEncryptionSince" = now() AT TIME ZONE 'UTC'`;

type Boot = FieldEncryptionStartOptions & { masterKeyring?: Keyring };
/** The gates, then the flag check, as instrumentation.ts runs them. */
async function boot(tx: Tx, options: Boot = {}) {
	const masterKeyring =
		"masterKeyring" in options ? options.masterKeyring : master;
	await assertStartGates({
		client: tx,
		masterKeyring,
		...(options.floor === undefined ? {} : { floor: options.floor }),
	});
	return assertFieldEncryptionStart({
		flag: false,
		production: false,
		client: tx,
		...options,
		masterKeyring,
	});
}
const refusal = (tx: Tx, options: Boot = {}) =>
	boot(tx, options).then(
		() => null,
		(error: unknown) => error as Error & { code?: string },
	);

let userId: string;
beforeAll(async () => {
	await resetInstanceKey();
	await instanceKeyring(master);
	userId = (await createTestUser()).user.id;
	await userKeyring(userId, master);
});
beforeEach(() => resetEpochForTests());
afterAll(async () => {
	resetEpochForTests();
	await resetInstanceKey();
});

describe("the floor write", () => {
	it("makes the settings row when there is none, and reads a missing row as 0", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM "app_settings"`;
			expect(await settings(tx)).toBeUndefined();
			expect(await raiseSealingFloor(tx, 1)).toBe(1);
			expect((await settings(tx))?.floor).toBe(1);
		});
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM "app_settings"`;
			await expect(
				assertStartGates({ client: tx, masterKeyring: undefined }),
			).resolves.toEqual({
				usersWithoutKey: 0,
			});
		});
	});

	it("never lowers it", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			expect(await raiseSealingFloor(tx, 3)).toBe(3);
			expect(await raiseSealingFloor(tx, 1)).toBe(3);
			expect((await settings(tx))?.floor).toBe(3);
		});
	});

	it("is written by the first flag-on start, with the epoch", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			expect((await settings(tx))?.floor).toBeNull();
			expect(await boot(tx, { flag: true, floor: 1 })).toBe("on");
			expect(await settings(tx)).toMatchObject({ floor: 1, epoch: true });
		});
	});

	it("is raised from 1 to 2 by a later start with the epoch already set", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			expect(await boot(tx, { flag: true, floor: 1 })).toBe("on");
			expect(await boot(tx, { flag: true, floor: 2 })).toBe("on");
			expect((await settings(tx))?.floor).toBe(2);
			const error = await refusal(tx, { flag: true, floor: 1 });
			expect(error?.code).toBe("code_below_floor");
			expect((await settings(tx))?.floor).toBe(2);
		});
	});

	it("is not raised by a flag-off start", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			expect(await boot(tx, { flag: false, floor: 5 })).toBe("off");
			expect((await settings(tx))?.floor).toBeNull();
		});
	});

	it("is refused by a flag-on start below a stored floor even before the epoch, and seals nothing", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await indexAll(tx);
			await raiseSealingFloor(tx, 2);
			const error = await refusal(tx, { flag: true, floor: 1 });
			expect(error?.code).toBe("code_below_floor");
			expect((await settings(tx))?.epoch).toBe(false);
		});
	});
});

describe("code_below_floor", () => {
	it("refuses floor 2 against code 1 once the epoch is set, whatever the flag", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			await raiseSealingFloor(tx, 2);
			for (const flag of [false, true]) {
				const error = await refusal(tx, { flag, floor: 1 });
				expect(error).toBeInstanceOf(StartGateError);
				expect(error?.code).toBe("code_below_floor");
				expect(error?.message).toMatch(/floor 2, this build 1/);
				expect(error?.message).toMatch(/Start the build that sealed it/);
			}
			expect(await boot(tx, { floor: 2 })).toBe("off");
			expect(await boot(tx, { floor: 3 })).toBe("off");
		});
	});

	it("lets code at floor 1 start on floor 2 while no epoch is set", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await raiseSealingFloor(tx, 2);
			expect((await settings(tx))?.epoch).toBe(false);
			expect(await boot(tx, { floor: 1 })).toBe("off");
		});
	});
});

describe("epoch_without_master_key", () => {
	it("refuses with the flag off and with the flag on", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			for (const flag of [false, true]) {
				const error = await refusal(tx, { flag, masterKeyring: undefined });
				expect(error?.code).toBe("epoch_without_master_key");
				expect(error?.message).toMatch(/Restore the original master key/);
			}
		});
	});

	it("applies to nothing before the epoch: no key, no instance key, no gate", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM keystore."instance_text_key"`;
			await tx.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
			expect(await boot(tx, { masterKeyring: undefined })).toBe("off");
		});
	});
});

describe("instance_key_lost", () => {
	it("refuses when the epoch is set and the instance key row is gone", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			await tx.$executeRaw`DELETE FROM keystore."instance_text_key"`;
			for (const flag of [false, true]) {
				const error = await refusal(tx, { flag });
				expect(error?.code).toBe("instance_key_lost");
				expect(error?.message).toMatch(/no key row/);
				expect(error?.message).toMatch(/restore the keystore dump/);
			}
		});
	});

	it("refuses when the epoch is set and instanceKeySince is null", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			await tx.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
			const error = await refusal(tx);
			expect(error?.code).toBe("instance_key_lost");
			expect(error?.message).toMatch(/marker not set/);
		});
	});

	it("refuses when the instance key does not open under the master key", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			const other = new Keyring([{ id: 1, key: randomBytes(32) }]);
			const error = await refusal(tx, { masterKeyring: other });
			expect(error?.code).toBe("instance_key_lost");
			expect(error?.message).toMatch(/does not open/);
		});
	});

	it("refuses a keystore schema that is gone", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			await tx.$executeRawUnsafe(
				"DROP TABLE keystore.instance_text_key CASCADE",
			);
			expect((await refusal(tx))?.code).toBe("instance_key_lost");
		});
	});

	it("starts with the epoch set and every key in place", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			expect(await boot(tx)).toBe("off");
		});
	});
});

describe("a user whose key is gone", () => {
	const warnings = () => vi.spyOn(console, "warn").mockImplementation(() => {});

	it("warns with a count, names no one, and starts", async () => {
		const warn = warnings();
		try {
			await inRolledBackPrismaTransaction(async (tx) => {
				await setEpoch(tx);
				const { usersWithoutKey: before } = await assertStartGates({
					client: tx,
					masterKeyring: master,
				});
				warn.mockClear();
				await tx.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
				expect(await boot(tx)).toBe("off");
				const { usersWithoutKey } = await assertStartGates({
					client: tx,
					masterKeyring: master,
				});
				expect(usersWithoutKey).toBe(before + 1);
				const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
				expect(text).toContain(`missing from the key store: ${before + 1}.`);
				expect(text).not.toContain(userId);
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("a user key row that does not open is a warning at most, never a refusal", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await setEpoch(tx);
			await tx.$executeRaw`UPDATE keystore."user_data_key" SET "wrappedKey" = 'garbage' WHERE "userId" = ${userId}`;
			expect(await boot(tx)).toBe("off");
		});
	});

	it("is not counted before the epoch", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
			expect(
				await assertStartGates({ client: tx, masterKeyring: master }),
			).toEqual({
				usersWithoutKey: 0,
			});
		});
	});
});
