import { removeUserExports } from "~/server/export-storage";
import { deleteFile } from "~/server/storage";

/**
 * Files a deleted account leaves in storage: its avatar, its account pictures, the screenshots it
 * sent with feedback and everything it exported. Idempotent, and a failure
 * only leaves a file behind; it never blocks the deletion.
 */
export async function removeUserFiles(
	userId: string,
	avatarPath: string | null,
	screenshotPaths: string[] = [],
	iconPaths: string[] = [],
): Promise<void> {
	if (avatarPath) await deleteFile(avatarPath).catch(() => {});
	for (const path of screenshotPaths) await deleteFile(path).catch(() => {});
	for (const path of iconPaths) await deleteFile(path).catch(() => {});
	await removeUserExports(userId).catch(() => {});
}
