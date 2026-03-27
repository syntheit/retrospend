import type { FullConfig } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, TEST_USER } from "./constants";

const APP_URL = process.env.E2E_BASE_URL ?? "http://localhost:1998";

// Use E2E_DATABASE_URL for test isolation; fall back to dev DATABASE_URL
const DATABASE_URL =
	process.env.E2E_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:testpassword@localhost:5433/retrospend_test";

async function deleteTestUsers(pool: Pool): Promise<void> {
	const emails = [TEST_USER.email, ADMIN_USER.email];

	// Delete in dependency order (sessions/accounts before users)
	await pool.query(
		`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ANY($1))`,
		[emails],
	);
	await pool.query(
		`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ANY($1))`,
		[emails],
	);
	// Budget and other data cascade from user deletion
	await pool.query(`DELETE FROM "user" WHERE email = ANY($1)`, [emails]);
}

async function disableInviteOnly(pool: Pool): Promise<boolean> {
	const result = await pool.query<{ inviteOnlyEnabled: boolean }>(
		`SELECT "inviteOnlyEnabled" FROM "app_settings" WHERE id = 'app_settings_singleton'`,
	);
	const wasEnabled = result.rows[0]?.inviteOnlyEnabled ?? false;
	if (wasEnabled) {
		await pool.query(
			`UPDATE "app_settings" SET "inviteOnlyEnabled" = false WHERE id = 'app_settings_singleton'`,
		);
	}
	return wasEnabled;
}

async function restoreInviteOnly(
	pool: Pool,
	wasEnabled: boolean,
): Promise<void> {
	if (wasEnabled) {
		await pool.query(
			`UPDATE "app_settings" SET "inviteOnlyEnabled" = true WHERE id = 'app_settings_singleton'`,
		);
	}
}

async function signUpUser(
	email: string,
	password: string,
	name: string,
	username: string,
): Promise<void> {
	const response = await fetch(`${APP_URL}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password, name, username }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Signup failed for ${email}: ${response.status} ${text}`);
	}
}

async function setUserRole(
	pool: Pool,
	email: string,
	role: "USER" | "ADMIN",
): Promise<void> {
	await pool.query(`UPDATE "user" SET role = $1 WHERE email = $2`, [
		role,
		email,
	]);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
	const pool = new Pool({ connectionString: DATABASE_URL });

	try {
		// Clean up test users from any previous run
		await deleteTestUsers(pool);

		// Temporarily disable invite-only so signup works
		const wasInviteOnly = await disableInviteOnly(pool);

		try {
			// Create test user (regular user)
			await signUpUser(
				TEST_USER.email,
				TEST_USER.password,
				TEST_USER.name,
				TEST_USER.username,
			);
			// Ensure role is USER (first user on a fresh DB would become ADMIN)
			await setUserRole(pool, TEST_USER.email, "USER");

			// Create admin user
			await signUpUser(
				ADMIN_USER.email,
				ADMIN_USER.password,
				ADMIN_USER.name,
				ADMIN_USER.username,
			);
			// Elevate to ADMIN
			await setUserRole(pool, ADMIN_USER.email, "ADMIN");
		} finally {
			await restoreInviteOnly(pool, wasInviteOnly);
		}

		console.log("✓ E2E test users seeded successfully");
	} finally {
		await pool.end();
	}
}
