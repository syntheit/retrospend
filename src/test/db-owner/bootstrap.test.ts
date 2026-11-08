// The bootstrap's decisions, with the database replaced by a recording fake:
// which URLs it leaves alone, and the order of what it does to one it takes
// over. The real database side is src/test/migrations/owner-role.pg.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fake = {
	/** Result of `SELECT rolsuper ...` for the URL's user. */
	superuser: boolean;
	/** Whether the owner can sign in, by attempt number (1-based). */
	ownerLogins: boolean[];
	log: string[];
	logins: number;
};
const fake: Fake = { superuser: true, ownerLogins: [], log: [], logins: 0 };

vi.mock("pg", () => {
	class Client {
		constructor(private readonly config: { connectionString: string }) {}
		async connect() {
			if (
				new URL(this.config.connectionString).username === "retrospend_owner"
			) {
				const ok = fake.ownerLogins[fake.logins++];
				if (!ok) throw new Error("password authentication failed");
			}
		}
		async query(sql: string) {
			// The bootstrap's SQL files are long: log which one ran.
			fake.log.push(
				sql.includes("CREATE ROLE retrospend_owner")
					? "owner-role.sql"
					: sql.includes("ALTER SCHEMA %I OWNER")
						? "owner-handover.sql"
						: (sql.trim().split("\n")[0] ?? ""),
			);
			if (sql.includes("SELECT rolsuper")) {
				const owner =
					new URL(this.config.connectionString).username === "retrospend_owner";
				return { rows: [{ rolsuper: owner ? false : fake.superuser }] };
			}
			if (sql.startsWith("ALTER ROLE")) fake.log.push(`ALTER ROLE: ${sql}`);
			return { rows: [] };
		}
		escapeLiteral(value: string) {
			return `'${value}'`;
		}
		async end() {}
	}
	return { default: { Client } };
});

const { bootstrap } = await import("../../../scripts/db-owner/index.mjs");

beforeEach(() => {
	fake.superuser = true;
	fake.ownerLogins = [];
	fake.log = [];
	fake.logins = 0;
});

describe("bootstrap leaves a URL alone", () => {
	it("when it is not a superuser's (managed Postgres, or set up by hand)", async () => {
		fake.superuser = false;
		const result = await bootstrap("postgresql://app:pw@db/retro");
		expect(result).toEqual({ status: "unchanged", reason: "not-superuser" });
		expect(fake.log.some((line) => line.startsWith("owner-"))).toBe(false);
	});

	it("when a superuser has no password, with a loud warning and no change", async () => {
		const warn = vi.fn();
		const result = await bootstrap("postgresql://postgres@db/retro", { warn });
		expect(result).toEqual({ status: "unchanged", reason: "no-password" });
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]?.[0]).toMatch(/^WARNING: .*without a password/);
		expect(fake.log.some((line) => /owner-|BEGIN/.test(line))).toBe(false);
	});

	it("when the password is not valid percent-encoding", async () => {
		const warn = vi.fn();
		const result = await bootstrap("postgresql://postgres:ab%zz@db/retro", {
			warn,
		});
		expect(result).toEqual({
			status: "unchanged",
			reason: "unreadable-password",
		});
		expect(warn.mock.calls[0]?.[0]).toMatch(/percent-encoded/);
	});
});

describe("bootstrap on a superuser URL with a password", () => {
	it("does not set the password when the owner can already sign in", async () => {
		fake.ownerLogins = [true];
		const result = await bootstrap("postgresql://postgres:pw@db/retro");
		expect(result.status).toBe("switched");
		expect(fake.log.some((line) => line.startsWith("ALTER ROLE"))).toBe(false);
		expect(fake.log).toContain("owner-role.sql");
		expect(fake.log).toContain("owner-handover.sql");
	});

	it("sets a SCRAM verifier, with statement logging off, only when the login fails", async () => {
		fake.ownerLogins = [false, true];
		const result = await bootstrap("postgresql://postgres:pw@db/retro");
		expect(result.status).toBe("switched");
		const set = fake.log.indexOf("SET LOCAL log_statement = 'none'");
		const alter = fake.log.findIndex((line) => line.startsWith("ALTER ROLE:"));
		expect(set).toBeGreaterThan(-1);
		expect(alter).toBeGreaterThan(set);
		const statement = fake.log[alter] ?? "";
		expect(statement).toMatch(
			/ALTER ROLE retrospend_owner PASSWORD 'SCRAM-SHA-256\$\d+:[^$]+\$[^:]+:.+'/,
		);
		// The derived password itself is never sent, only its verifier.
		expect(statement).not.toMatch(/PASSWORD '[0-9a-f]{64}'/);
		expect(fake.log.indexOf("COMMIT")).toBeGreaterThan(alter);
	});

	it("fails the start when the owner still cannot sign in after the reset", async () => {
		fake.ownerLogins = [false, false];
		await expect(
			bootstrap("postgresql://postgres:pw@db/retro"),
		).rejects.toThrow(/cannot sign in/);
	});

	it("takes DATABASE_OWNER_PASSWORD even when the URL has no password", async () => {
		fake.ownerLogins = [true];
		const result = await bootstrap("postgresql://postgres@db/retro", {
			ownerPassword: "own-secret",
		});
		expect(result.status).toBe("switched");
		if (result.status === "switched") {
			expect(new URL(result.ownerUrl).password).toBe("own-secret");
		}
	});
});
