import * as LocalAuthentication from "expo-local-authentication";

/**
 * Whether this phone has a screen lock or biometrics set up, so it can ask
 * "is it you" before a destructive admin action. A phone with none (or one
 * whose check fails) falls back to typing the account's email.
 */
export async function hasDeviceLock(): Promise<boolean> {
	try {
		const level = await LocalAuthentication.getEnrolledLevelAsync();
		return level !== LocalAuthentication.SecurityLevel.NONE;
	} catch {
		return false;
	}
}

/**
 * Asks the device to confirm it is the owner: Face ID, Touch ID or the
 * passcode on iOS, a biometric or the device credential on Android. True only
 * when the person passed; a cancel or a failure is false.
 */
export async function confirmWithDevice(
	promptMessage: string,
	cancelLabel: string,
): Promise<boolean> {
	try {
		const result = await LocalAuthentication.authenticateAsync({
			promptMessage,
			cancelLabel,
			disableDeviceFallback: false,
		});
		return result.success;
	} catch {
		return false;
	}
}

/** Whether what was typed is the account's email, ignoring case and outer spaces. */
export function emailMatches(typed: string, email: string): boolean {
	return typed.trim().toLocaleLowerCase() === email.trim().toLocaleLowerCase();
}
