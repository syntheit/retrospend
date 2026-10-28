// Not Android: iOS gets its notifications from APNs and polls nothing (the
// real one is background.android.ts).
export const POLL_TASK = "retrospend.push.poll";
export async function startPolling(): Promise<void> {}
export async function stopPolling(): Promise<void> {}
export async function pollNowForTesting(): Promise<boolean> {
	return false;
}
