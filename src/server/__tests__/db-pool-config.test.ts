import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
	appPoolConfig,
	IDLE_IN_TRANSACTION_TIMEOUT_MS,
} from "~/server/db-pool-config";

/** The `options` startup parameter pg would send for this config. */
function optionsSent(config: ReturnType<typeof appPoolConfig>): string {
	const client = new Client(config) as unknown as {
		connectionParameters: { options?: string };
	};
	return client.connectionParameters.options ?? "";
}

const URL_BASE = "postgresql://user:p%40ss@localhost:5432/app";

describe("appPoolConfig", () => {
	it("sets the idle in transaction timeout on a URL with no options", () => {
		expect(optionsSent(appPoolConfig(URL_BASE))).toBe(
			`-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
		);
	});

	it("keeps the options already in the URL and adds the timeout", () => {
		const sent = optionsSent(
			appPoolConfig(`${URL_BASE}?options=-c%20search_path%3Dapp`),
		);
		expect(sent).toBe(
			`-c search_path=app -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
		);
	});

	it("keeps other query parameters and leaves the credentials as given", () => {
		const config = appPoolConfig(`${URL_BASE}?sslmode=disable&options=-c%20a%3Db`);
		expect(config.connectionString?.startsWith(`${URL_BASE}?`)).toBe(true);
		expect(config.connectionString).toContain("sslmode=disable");
	});

	it("keeps an operator's own value for the setting", () => {
		const url = `${URL_BASE}?options=-c%20idle_in_transaction_session_timeout%3D5000`;
		expect(optionsSent(appPoolConfig(url))).toBe(
			"-c idle_in_transaction_session_timeout=5000",
		);
	});

	it("takes the timeout from the second argument", () => {
		expect(optionsSent(appPoolConfig(URL_BASE, 1500))).toBe(
			"-c idle_in_transaction_session_timeout=1500",
		);
	});
});
