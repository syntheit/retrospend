import { removeUserExports } from "~/server/export-storage";
import { deleteFile } from "~/server/storage";

/**
 * Files a deleted account leaves in storage: its avatar and everything it
 * exported. Idempotent, and a failure only leaves a file behind; it never
 * blocks the deletion.
 */
export async function removeUserFiles(
	userId: string,
	avatarPath: string | null,
): Promise<void> {
	if (avatarPath) await deleteFile(avatarPath).catch(() => {});
	await removeUserExports(userId).catch(() => {});
}
