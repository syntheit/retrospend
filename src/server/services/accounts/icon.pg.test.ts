/**
 * The mark beside an account on real Postgres through RLS: a bundled logo or
 * a monogram color is set and cleared, an uploaded picture is re-encoded and
 * replaces the one before it, only the owner can change it, editing the
 * account leaves it alone, and neither the change nor the edit moves the
 * account's "updated" day.
 */
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { accountItemIn } from "~/server/services/api-v1/accounts/items";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../../api/routers/wealth";

vi.mock("~/server/storage", async () => {
	const { getImageUrl } = await import("~/lib/image-url");
	return {
		uploadFile: vi.fn(async (path: string) => path),
		deleteFile: vi.fn(async () => undefined),
		getImageUrl,
	};
});

import { randomUUID } from "node:crypto";
import {
	deleteAccountMutation,
	undeleteAccountMutation,
} from "~/server/services/api-v1/accounts/mutations";
import { pruneExpiredKeys } from "~/server/services/api-v1/idempotency.service";
import { forUser } from "~/server/services/preview";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import { deleteFile, uploadFile } from "~/server/storage";
import { replaceAccountImage, setAccountIcon } from "./icon";
import { deleteAccount, editAccount } from "./manage";
import { arsUser, openAccount, seedArsRates } from "./test-fixtures";

beforeAll(seedArsRates);
beforeEach(() => {
	vi.clearAllMocks();
});

const row = (id: string) =>
	fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });

const png = () =>
	sharp({
		create: { width: 8, height: 4, channels: 3, background: "#336699" },
	})
		.png()
		.toBuffer();

describe("setAccountIcon", () => {
	it("sets a logo, then a monogram color, then clears it", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Revolut", "CASH", "ARS", 1000);
		const db = adminDb;

		await setAccountIcon(db, user.id, id, { kind: "BRAND", value: "revolut" });
		expect(await row(id)).toMatchObject({
			iconKind: "BRAND",
			iconValue: "revolut",
		});

		await setAccountIcon(db, user.id, id, {
			kind: "MONOGRAM",
			value: "avatar-3",
		});
		expect(await row(id)).toMatchObject({
			iconKind: "MONOGRAM",
			iconValue: "avatar-3",
		});

		await setAccountIcon(db, user.id, id, null);
		expect(await row(id)).toMatchObject({ iconKind: null, iconValue: null });
	});

	it("refuses a logo we do not ship, a bad color and an image path", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Cash", "CASH", "ARS", 1000);
		for (const icon of [
			{ kind: "BRAND", value: "not-a-brand" },
			{ kind: "MONOGRAM", value: "hotpink" },
			{ kind: "IMAGE", value: "accounts/x-1.webp" },
		] as const) {
			await expect(
				setAccountIcon(adminDb, user.id, id, icon),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		expect(await row(id)).toMatchObject({ iconKind: null });
	});

	it("is the owner's alone", async () => {
		const { user } = await arsUser();
		const other = await createTestUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);
		await expect(
			setAccountIcon(adminDb, other.user.id, id, {
				kind: "BRAND",
				value: "wise",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await row(id)).toMatchObject({ iconKind: null });
	});

	it("does not move the account's updated day", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Wise", "CASH", "ARS", 1000);
		const before = (await row(id)).updatedAt;
		await setAccountIcon(adminDb, user.id, id, {
			kind: "BRAND",
			value: "wise",
		});
		expect((await row(id)).updatedAt).toEqual(before);
	});

	it("goes through the wealth router and shows on the dashboard and the API item", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Nubank", "CASH", "ARS", 1000);
		const caller = createCallerFactory(wealthRouter)({
			session: makeSession({ id: user.id }),
			db: adminDb,
		} as never);
		await caller.setAssetIcon({
			id,
			icon: { kind: "BRAND", value: "nubank" },
		});
		const dashboard = await caller.getDashboard({ currency: "ARS" });
		expect(dashboard.assets.find((a) => a.id === id)).toMatchObject({
			iconKind: "BRAND",
			iconValue: "nubank",
		});
		const item = await adminDb.$transaction((tx) =>
			accountItemIn(tx, user.id, id),
		);
		expect(item.icon).toEqual({ kind: "BRAND", value: "nubank" });
	});

	it("editing the account keeps its icon", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Coinbase", "CRYPTO", "ARS", 500);
		await setAccountIcon(adminDb, user.id, id, {
			kind: "BRAND",
			value: "coinbase",
		});
		await editAccount(adminDb, user.id, id, {
			name: "Coinbase main",
			type: "CRYPTO",
			currency: "ARS",
			balance: 600,
			isLiquid: true,
		});
		expect(await row(id)).toMatchObject({
			name: "Coinbase main",
			iconKind: "BRAND",
			iconValue: "coinbase",
		});
	});
});

describe("replaceAccountImage", () => {
	it("re-encodes the picture and stores it under accounts/", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);
		const icon = await replaceAccountImage(adminDb, user.id, id, await png());

		const saved = await row(id);
		expect(saved.iconKind).toBe("IMAGE");
		expect(saved.iconValue).toMatch(
			new RegExp(`^accounts/${id}-\\d+-[0-9a-f]{8}\\.webp$`),
		);
		expect(icon).toEqual({
			kind: "IMAGE",
			value: `/api/images/${saved.iconValue}`,
		});
		const [path, bytes, type] = vi.mocked(uploadFile).mock.calls[0] ?? [];
		expect(path).toBe(saved.iconValue);
		expect(type).toBe("image/webp");
		const meta = await sharp(bytes as Buffer).metadata();
		expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
	});

	it("deletes the picture it replaces, and the one a logo replaces", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);
		await replaceAccountImage(adminDb, user.id, id, await png());
		const first = (await row(id)).iconValue;
		await new Promise((r) => setTimeout(r, 5));
		await replaceAccountImage(adminDb, user.id, id, await png());
		expect(deleteFile).toHaveBeenCalledWith(first);
		const second = (await row(id)).iconValue;
		expect(second).not.toBe(first);

		await setAccountIcon(adminDb, user.id, id, {
			kind: "BRAND",
			value: "wise",
		});
		expect(deleteFile).toHaveBeenCalledWith(second);
	});

	it("refuses what is not an image, what is too large and an account that is not yours", async () => {
		const { user } = await arsUser();
		const other = await createTestUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);

		await expect(
			replaceAccountImage(adminDb, user.id, id, Buffer.from("not an image")),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			replaceAccountImage(
				adminDb,
				user.id,
				id,
				Buffer.alloc(5 * 1024 * 1024 + 1),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			replaceAccountImage(adminDb, other.user.id, id, await png()),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(uploadFile).not.toHaveBeenCalled();
		expect(await row(id)).toMatchObject({ iconKind: null });
	});
});

describe("the picture's files", () => {
	it("two uploads at once leave one file referenced and delete the other", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);
		await Promise.all([
			replaceAccountImage(adminDb, user.id, id, await png()),
			replaceAccountImage(adminDb, user.id, id, await png()),
		]);
		const kept = (await row(id)).iconValue;
		const uploaded = vi.mocked(uploadFile).mock.calls.map((c) => c[0]);
		expect(uploaded).toHaveLength(2);
		expect(uploaded).toContain(kept);
		const lost = uploaded.find((p) => p !== kept);
		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(lost);
		expect(vi.mocked(deleteFile)).not.toHaveBeenCalledWith(kept);
	});

	it("deleting the account on the web deletes its picture", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Mine", "CASH", "ARS", 1000);
		await replaceAccountImage(adminDb, user.id, id, await png());
		const path = (await row(id)).iconValue;
		await deleteAccount(adminDb, user.id, id);
		expect(deleteFile).toHaveBeenCalledWith(path);
	});

	/** An account with an uploaded picture, deleted with an undo: its picture and stash. */
	async function deletedWithPicture(userId: string, name = "Mine") {
		const id = await openAccount(userId, name, "CASH", "ARS", 1000);
		await replaceAccountImage(adminDb, userId, id, await png());
		const path = (await row(id)).iconValue as string;
		const gone = await forUser(userId).apply(deleteAccountMutation, { id });
		vi.mocked(deleteFile).mockClear();
		return { path, stash: gone.value.stash };
	}

	const expire = (userId: string) =>
		adminDb.idempotencyKey.updateMany({
			where: { userId },
			data: { expiresAt: new Date(Date.now() - 1000) },
		});

	it("keeps the picture while an undo can bring the account back, then prunes it", async () => {
		const { user } = await arsUser();
		const { path } = await deletedWithPicture(user.id);
		await pruneExpiredKeys();
		expect(deleteFile).not.toHaveBeenCalledWith(path);

		await expire(user.id);
		await pruneExpiredKeys();
		expect(deleteFile).toHaveBeenCalledWith(path);
	});

	it("an undo takes the kept file with it, so the restored picture is never pruned", async () => {
		const { user } = await arsUser();
		const { path, stash } = await deletedWithPicture(user.id);
		await forUser(user.id).apply(undeleteAccountMutation, { stash });
		await expire(user.id);
		await pruneExpiredKeys();
		expect(deleteFile).not.toHaveBeenCalledWith(path);
	});

	it("deletes files only for rows the stash module wrote", async () => {
		const { user } = await arsUser();
		const path = "accounts/forged.webp";
		// A row shaped like a kept file without the server's marker, as an
		// Idempotency-Key from a client would be stored.
		await adminDb.idempotencyKey.create({
			data: {
				userId: user.id,
				key: `undo-icon:${randomUUID()}:${path}`,
				requestHash: "a".repeat(64),
				expiresAt: new Date(Date.now() - 1000),
			},
		});
		await pruneExpiredKeys();
		expect(deleteFile).not.toHaveBeenCalledWith(path);
		await expect(
			adminDb.idempotencyKey.count({ where: { userId: user.id } }),
		).resolves.toBe(0);
	});

	it("deleting the user deletes live and stashed pictures", async () => {
		const { user } = await arsUser();
		const live = await openAccount(user.id, "Live", "CASH", "ARS", 1000);
		await replaceAccountImage(adminDb, user.id, live, await png());
		const { path } = await deletedWithPicture(user.id, "Gone");
		const paths = [(await row(live)).iconValue, path];
		await anonymizeAndDeleteUser(adminDb, user.id, user.email, null);
		for (const p of paths) expect(deleteFile).toHaveBeenCalledWith(p);
	});
});
