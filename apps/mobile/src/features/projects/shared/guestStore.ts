import { secureStore } from "@/lib/secure-store";
import type { GuestRecord } from "./sharedAccess";

// A guest session token and a viewer link are secrets that let a person back
// into one project, so they live in the keystore with the bearer tokens, one
// entry per project.

const key = (projectId: string) => `retrospend.guest.${projectId}`;

export async function readGuestRecord(
	projectId: string,
): Promise<GuestRecord | null> {
	try {
		const raw = await secureStore.getItemAsync(key(projectId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<GuestRecord>;
		if (parsed.projectId !== projectId || typeof parsed.baseUrl !== "string")
			return null;
		return {
			baseUrl: parsed.baseUrl,
			projectId,
			projectName: parsed.projectName ?? null,
			token: parsed.token ?? null,
			sessionId: parsed.sessionId ?? null,
			viewerLink: parsed.viewerLink ?? null,
			name: parsed.name ?? null,
		};
	} catch {
		return null;
	}
}

export async function writeGuestRecord(record: GuestRecord): Promise<void> {
	await secureStore.setItemAsync(key(record.projectId), JSON.stringify(record));
}

export async function clearGuestRecord(projectId: string): Promise<void> {
	try {
		await secureStore.deleteItemAsync(key(projectId));
	} catch {
		// Nothing to forget.
	}
}
