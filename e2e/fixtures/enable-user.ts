/**
 * One plain account (a typed password, no protection keys, email verified
 * because e2e has no mail) that turns Advanced protection on in a flow
 * (protection-enable.spec.ts). Turning it on moves the account to a sign-in
 * secret, so no other flow may sign in as it. It is signed up through the app
 * like the blank accounts, and is not a persona.
 */
import { assertE2eDatabase } from "../db-guard";

export const ENABLE_USER = {
	name: "Enable E2E User",
	username: "enablee2e",
	email: "enable.e2e@example.com",
	password: "Enable-e2e-2026!",
	/** The password that unlocks the keys; the old one stops working. */
	newPassword: "Enabled-e2e-2027?",
} as const;

export async function seedEnableUser(
	databaseUrl: string,
	signUp: (
		email: string,
		password: string,
		name: string,
		username: string,
	) => Promise<void>,
): Promise<void> {
	assertE2eDatabase(databaseUrl);
	await signUp(
		ENABLE_USER.email,
		ENABLE_USER.password,
		ENABLE_USER.name,
		ENABLE_USER.username,
	);
}
