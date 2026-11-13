import type { FullConfig } from "@playwright/test";
import { Pool } from "pg";
import {
	ADMIN_USER,
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	E2E_SEALED,
	TEST_USER,
} from "./constants";
import { assertE2eDatabase } from "./db-guard";
import { seedE2eDatabase } from "./fixtures/seed";
import { indexSeedCategories, snapshotSeedIds } from "./sealing-seed";

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
 *
 * Sealed (E2E_SEALED=1): the server already wrote its canary, instance key,
 * floor and epoch into the database the reset emptied, so the wipe keeps
 * `app_settings`. The seed is legacy plaintext, so its categories get their
 * name index the way the runbook does it, and the ids it wrote are saved for
 * e2e/flows/zz-sealing.spec.ts. The sign-ups below go through the server, so
 * those two accounts are sealed.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
	await seedE2eDatabase(
		E2E_DATABASE_URL,
		undefined,
		assertE2eDatabase,
		E2E_SEALED,
	);
	if (E2E_SEALED) {
		indexSeedCategories();
		await snapshotSeedIds();
	}

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
