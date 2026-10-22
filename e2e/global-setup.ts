import type { FullConfig } from "@playwright/test";
import { Pool } from "pg";
import {
	ADMIN_USER,
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	TEST_USER,
} from "./constants";
import { seedE2eDatabase } from "./fixtures/seed";

async function signUpUser(
	email: string,
	password: string,
	name: string,
	username: string,
): Promise<void> {
	const response = await fetch(`${E2E_BASE_URL}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: E2E_BASE_URL },
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

/**
 * Runs after the web server is up. Wipes the e2e database and writes the
 * personas (fixtures/seed.ts), then signs up the two blank accounts the older
 * specs use through the real sign-up endpoint.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
	await seedE2eDatabase(E2E_DATABASE_URL);

	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await signUpUser(
			TEST_USER.email,
			TEST_USER.password,
			TEST_USER.name,
			TEST_USER.username,
		);
		await setUserRole(pool, TEST_USER.email, "USER");

		await signUpUser(
			ADMIN_USER.email,
			ADMIN_USER.password,
			ADMIN_USER.name,
			ADMIN_USER.username,
		);
		await setUserRole(pool, ADMIN_USER.email, "ADMIN");
	} finally {
		await pool.end();
	}
	console.log("E2E database seeded");
}
