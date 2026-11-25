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

/**
 * One more plain account, for the flow where an admin's reset link sets a new
 * password through the reset page (reset-plain.spec.ts). Like the enable
 * account it is used up by its flow: no other flow may sign in as it.
 */
export const PLAIN_RESET_USER = {
	name: "Plain Reset E2E User",
	username: "plainresete2e",
	email: "plain.reset.e2e@example.com",
	password: "Plain-reset-2026!",
	newPassword: "Reset-plain-2027?",
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
	await signUp(
		PLAIN_RESET_USER.email,
		PLAIN_RESET_USER.password,
		PLAIN_RESET_USER.name,
		PLAIN_RESET_USER.username,
	);
}
