/**
 * The mark beside an account (lib/account-icons). Not a money move: it
 * changes how the account looks and nothing it counts, so it has no preview
 * and no Undo, and it leaves the account's "updated" day alone.
 */
import { AVATAR_MAX_BYTES } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { type AccountIcon, isAccountIcon } from "~/lib/account-icons";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { processAccountIcon } from "~/server/image-processing";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";
import type { PrismaClient } from "~prisma";

type AppDb = Pick<PrismaClient, "$transaction">;

async function deleteQuietly(path: string) {
	try {
		await deleteFile(path);
	} catch (err) {
		console.warn("Failed to delete an old account icon:", err);
	}
}

/** Swaps the stored icon and returns the file it replaced, to delete after the commit. */
async function swapIcon(
	db: AppDb,
	userId: string,
	id: string,
	next: AccountIcon | null,
): Promise<string | null> {
	return userTransaction(db, userId, async (tx) => {
		const row = await tx.assetAccount.findFirst({
			where: { id, userId },
			select: { iconKind: true, iconValue: true, updatedAt: true },
		});
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
		}
		await tx.assetAccount.update({
			where: { id },
			data: {
				iconKind: next?.kind ?? null,
				iconValue: next?.value ?? null,
				updatedAt: row.updatedAt,
			},
		});
		const old = row.iconKind === "IMAGE" ? row.iconValue : null;
		return old && old !== next?.value ? old : null;
	});
}

/** A logo, a monogram color or none. An uploaded image goes through replaceAccountImage. */
export async function setAccountIcon(
	db: AppDb,
	userId: string,
	id: string,
	icon: AccountIcon | null,
): Promise<AccountIcon | null> {
	if (
		icon &&
		(icon.kind === "IMAGE" || !isAccountIcon(icon.kind, icon.value))
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "That icon is not one we have.",
		});
	}
	const old = await swapIcon(db, userId, id, icon);
	if (old) await deleteQuietly(old);
	return icon;
}

/**
 * Stores the person's own picture as the account's icon, re-encoded like the
 * profile picture (same size cap, same accepted types), so what is served is
 * never the uploaded bytes.
 */
export async function replaceAccountImage(
	db: AppDb,
	userId: string,
	id: string,
	input: Buffer,
): Promise<AccountIcon> {
	if (input.byteLength > AVATAR_MAX_BYTES) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "File too large. Maximum 5MB.",
		});
	}
	const owned = await userTransaction(db, userId, (tx) =>
		tx.assetAccount.findFirst({ where: { id, userId }, select: { id: true } }),
	);
	if (!owned) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
	}
	let processed: Buffer;
	try {
		processed = await processAccountIcon(input);
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: err instanceof Error ? err.message : "Invalid image format",
		});
	}
	const path = `accounts/${id}-${Date.now()}.webp`;
	await uploadFile(path, processed, "image/webp");
	let old: string | null;
	try {
		old = await swapIcon(db, userId, id, { kind: "IMAGE", value: path });
	} catch (err) {
		await deleteQuietly(path);
		throw err;
	}
	if (old) await deleteQuietly(old);
	return { kind: "IMAGE", value: getImageUrl(path) ?? path };
}

/**
 * The upload route's entry: the signed-in person must still be active, as
 * for the other uploads. The route holds the session, the service the rest.
 */
export async function uploadAccountIcon(
	userId: string,
	accountId: string,
	input: Buffer,
): Promise<AccountIcon> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { isActive: true },
	});
	if (!user?.isActive) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
	}
	return replaceAccountImage(db, userId, accountId, input);
}
