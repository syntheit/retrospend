import { AVATAR_MAX_BYTES } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { processAvatar } from "~/server/image-processing";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";

type AppDb = typeof globalDb;

/**
 * Profile pictures, for the web's upload route and PUT /api/v1/profile/avatar.
 * The image is re-encoded (processAvatar) before it is stored, so what is
 * served is never the uploaded bytes.
 */
export async function replaceAvatar(
	db: AppDb,
	userId: string,
	input: Buffer,
): Promise<{ avatarUrl: string }> {
	if (input.byteLength > AVATAR_MAX_BYTES) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "File too large. Maximum 5MB.",
		});
	}
	let processed: Buffer;
	try {
		processed = await processAvatar(input);
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: err instanceof Error ? err.message : "Invalid image format",
		});
	}

	const filePath = `avatars/${userId}-${Date.now()}.webp`;
	await uploadFile(filePath, processed, "image/webp");

	const before = await db.user.findUnique({
		where: { id: userId },
		select: { avatarPath: true },
	});
	// If this update fails the new file is orphaned on disk; a cleanup job
	// for unreferenced files would collect it.
	await db.user.update({
		where: { id: userId },
		data: { avatarPath: filePath },
	});
	if (before?.avatarPath) await deleteQuietly(before.avatarPath);
	return { avatarUrl: getImageUrl(filePath) ?? filePath };
}

export async function removeAvatar(db: AppDb, userId: string): Promise<void> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { avatarPath: true },
	});
	if (!user?.avatarPath) return;
	await deleteQuietly(user.avatarPath);
	await db.user.update({ where: { id: userId }, data: { avatarPath: null } });
}

async function deleteQuietly(path: string) {
	try {
		await deleteFile(path);
	} catch (err) {
		console.warn("Failed to delete old avatar (may already be gone):", err);
	}
}
