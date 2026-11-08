// What the app process is given. docker-entrypoint.sh holds the database
// superuser's URL while it prepares the database, then replaces itself with
// the app. Nothing that holds the superuser's password may reach the app's
// environment (/proc/<pid>/environ), because code running in the app could read
// it. These tests build the environment the way the entrypoint does and run a
// real shell on it.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	APP_ENV_NAMES,
	buildAppEnv,
	buildToolEnv,
	ownerUrl,
	shellExecPrefix,
} from "../../../scripts/db-owner/index.mjs";
import { REPO_ROOT } from "../uiRules/paths";

const SUPER_PASSWORD = "S3cr3t:pa$$/w'rd";
const SUPER_ENCODED = encodeURIComponent(SUPER_PASSWORD);
const SUPER_URL = `postgresql://postgres:${SUPER_ENCODED}@postgres:5432/retrospend`;
const OWNER_URL = ownerUrl(SUPER_URL, "0".repeat(64));

/** The container's environment as compose and the base image give it. */
const CONTAINER_ENV: NodeJS.ProcessEnv = {
	PATH: "/usr/local/bin:/usr/bin:/bin",
	HOME: "/home/nextjs",
	HOSTNAME: "0.0.0.0",
	PORT: "1997",
	NODE_ENV: "production",
	NODE_VERSION: "24.0.0",
	AUTH_SECRET: "auth secret with spaces",
	DATABASE_URL: SUPER_URL,
	POSTGRES_USER: "postgres",
	POSTGRES_PASSWORD: SUPER_PASSWORD,
	POSTGRES_DB_NAME: "retrospend",
	DATABASE_OWNER_PASSWORD: "override",
	SUPERUSER_URL_COPY: SUPER_URL,
	WORKER_API_KEY: "key'with\"quotes",
	APNS_KEY:
		"-----BEGIN PRIVATE KEY-----\nline1\nline2\n-----END PRIVATE KEY-----",
	NEXT_PUBLIC_APP_URL: "https://example.test",
	SMTP_PASSWORD: "$HOME `id` $(id)",
};

describe("buildAppEnv", () => {
	const { env, dropped } = buildAppEnv(CONTAINER_ENV, OWNER_URL);

	it("sets DATABASE_URL to the owner's URL", () => {
		expect(env.DATABASE_URL).toBe(OWNER_URL);
	});

	it("keeps no value that contains the superuser's password, in any spelling", () => {
		for (const [name, value] of Object.entries(env)) {
			expect(value, name).not.toContain(SUPER_PASSWORD);
			expect(value, name).not.toContain(SUPER_ENCODED);
		}
	});

	it("drops the variables only the entrypoint needs, and names them", () => {
		for (const name of [
			"POSTGRES_PASSWORD",
			"POSTGRES_USER",
			"DATABASE_OWNER_PASSWORD",
			"SUPERUSER_URL_COPY",
		]) {
			expect(env).not.toHaveProperty(name);
		}
		expect(dropped).toEqual(["SUPERUSER_URL_COPY"]);
	});

	it("keeps what the app reads, byte for byte", () => {
		expect(env.AUTH_SECRET).toBe(CONTAINER_ENV.AUTH_SECRET);
		expect(env.WORKER_API_KEY).toBe(CONTAINER_ENV.WORKER_API_KEY);
		expect(env.APNS_KEY).toBe(CONTAINER_ENV.APNS_KEY);
		expect(env.SMTP_PASSWORD).toBe(CONTAINER_ENV.SMTP_PASSWORD);
		expect(env.NEXT_PUBLIC_APP_URL).toBe(CONTAINER_ENV.NEXT_PUBLIC_APP_URL);
		expect(env.PATH).toBe(CONTAINER_ENV.PATH);
	});
});

describe("buildToolEnv (migrations and the grants file)", () => {
	const env = buildToolEnv(CONTAINER_ENV, OWNER_URL);

	it("has the owner's URL and no value with the superuser's password", () => {
		expect(env.DATABASE_URL).toBe(OWNER_URL);
		for (const [name, value] of Object.entries(env)) {
			expect(value, name).not.toContain(SUPER_PASSWORD);
			expect(value, name).not.toContain(SUPER_ENCODED);
		}
		expect(env).not.toHaveProperty("POSTGRES_PASSWORD");
		expect(env).not.toHaveProperty("DATABASE_OWNER_PASSWORD");
	});

	it("leaves out the app's secrets, and keeps what Prisma and the system need", () => {
		expect(env).not.toHaveProperty("AUTH_SECRET");
		expect(env).not.toHaveProperty("WORKER_API_KEY");
		const withPrisma = buildToolEnv(
			{ PATH: "/bin", PRISMA_SCHEMA_ENGINE_BINARY: "/nix/engine", HOME: "/h" },
			OWNER_URL,
		);
		expect(withPrisma).toEqual({
			PATH: "/bin",
			PRISMA_SCHEMA_ENGINE_BINARY: "/nix/engine",
			HOME: "/h",
			DATABASE_URL: OWNER_URL,
		});
	});
});

describe("the line the entrypoint evals", () => {
	it("starts the command with exactly that environment and nothing else", () => {
		const { env } = buildAppEnv(CONTAINER_ENV, OWNER_URL);
		const run = spawnSync(
			"sh",
			["-c", `${shellExecPrefix(env)}\nexec "$@"`, "sh", "env", "-0"],
			// The shell itself starts with the superuser's variables, like the
			// entrypoint does; `env -i` must leave them behind.
			{ env: CONTAINER_ENV, encoding: "utf8" },
		);
		expect(run.status).toBe(0);
		const seen = Object.fromEntries(
			run.stdout
				.split("\0")
				.filter(Boolean)
				.map((entry) => {
					const at = entry.indexOf("=");
					return [entry.slice(0, at), entry.slice(at + 1)];
				}),
		);
		expect(seen).toEqual(env);
		expect(run.stdout).not.toContain(SUPER_PASSWORD);
		expect(run.stdout).not.toContain(SUPER_ENCODED);
	});

	it("keeps the command's own arguments", () => {
		const { env } = buildAppEnv({ PATH: CONTAINER_ENV.PATH }, OWNER_URL);
		const run = spawnSync(
			"sh",
			["-c", `${shellExecPrefix(env)}\nexec "$@"`, "sh", "env"],
			{ encoding: "utf8" },
		);
		expect(run.stdout.trim().split("\n")).toContain(
			`DATABASE_URL=${OWNER_URL}`,
		);
	});

	it("is what `cli.mjs app-exec` prints for the entrypoint's environment", () => {
		const cli = spawnSync(
			process.execPath,
			[join(REPO_ROOT, "scripts/db-owner/cli.mjs"), "app-exec"],
			// The entrypoint has exported the owner's URL by now.
			{
				env: { ...CONTAINER_ENV, DATABASE_URL: OWNER_URL },
				encoding: "utf8",
			},
		);
		expect(cli.status).toBe(0);
		// Names only on stderr: never a value.
		expect(cli.stderr).toContain("SUPERUSER_URL_COPY");
		expect(cli.stderr).not.toContain(SUPER_PASSWORD);
		const run = spawnSync(
			"sh",
			["-c", `${cli.stdout}\nexec "$@"`, "sh", "env"],
			{ env: CONTAINER_ENV, encoding: "utf8" },
		);
		expect(run.status).toBe(0);
		expect(run.stdout).toContain(`DATABASE_URL=${OWNER_URL}`);
		expect(run.stdout).not.toContain(SUPER_PASSWORD);
		expect(run.stdout).not.toContain(SUPER_ENCODED);
		expect(run.stdout).not.toContain("POSTGRES_PASSWORD");
	});
});

describe("the allowlist", () => {
	/** Variables read in src that the app process does not need from the container. */
	const NOT_FOR_APP = new Set([
		"ANALYZE", // build only
		"SKIP_ENV_VALIDATION", // build only
		"PG_TEST_WORKERS", // tests
		"TEST_DATABASE_URL", // tests
		"VITEST_POOL_ID", // tests
		"VERCEL_URL", // not hosted there
		"PG_TEST_SUPER_URL", // tests
	]);

	function sources(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				return entry.name === "node_modules" || entry.name === "__tests__"
					? []
					: sources(path);
			}
			return /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
				!/\.(test|spec)\./.test(entry.name)
				? [path]
				: [];
		});
	}

	it("lists every variable the app source reads, so a new one is not silently dropped", () => {
		const read = new Set<string>();
		for (const file of sources(join(REPO_ROOT, "src"))) {
			for (const m of readFileSync(file, "utf8").matchAll(
				/process\.env\.([A-Z][A-Z0-9_]*)/g,
			)) {
				if (m[1]) read.add(m[1]);
			}
		}
		expect(read.size).toBeGreaterThan(30);
		const missing = [...read].filter(
			(name) =>
				!NOT_FOR_APP.has(name) &&
				!APP_ENV_NAMES.includes(name) &&
				!name.startsWith("NEXT_PUBLIC_"),
		);
		expect(missing).toEqual([]);
	});

	it("never lets the database superuser's credentials through", () => {
		for (const name of APP_ENV_NAMES) {
			expect(name).not.toMatch(/^POSTGRES_|OWNER_PASSWORD|SUPER/);
		}
	});
});

describe("docker-entrypoint.sh", () => {
	const script = readFileSync(join(REPO_ROOT, "docker-entrypoint.sh"), "utf8");
	const lines = script
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));

	it("does all the database work in one step, before anything else runs, and runs no prisma itself", () => {
		const at = (needle: string) =>
			lines.findIndex((line) => line.includes(needle));
		const prepare = at("db-owner/cli.mjs prepare");
		expect(prepare).toBeGreaterThan(-1);
		expect(lines[prepare]).toMatch(/^OWNER_DATABASE_URL=\$\(node /);
		expect(prepare).toBeLessThan(at("cli.mjs app-exec"));
		// The migrations (with their recovery) and the grants file are the CLI's:
		// a brand-new install's one-shot role holds CREATE on the database inside
		// them and not after.
		expect(lines.join("\n")).not.toMatch(/prisma/);
		expect(lines.join("\n")).not.toMatch(/migrate/i);
	});

	it("builds the app's environment last and replaces itself with the app", () => {
		expect(lines.at(-1)).toBe('exec "$@"');
		const app = lines.findIndex((line) => line.includes("cli.mjs app-exec"));
		expect(app).toBeGreaterThan(-1);
		expect(lines.slice(app).filter((l) => l.startsWith("eval "))).toEqual([
			'eval "$APP_EXEC"',
		]);
		// The command substitution is assigned on its own line so set -e sees a
		// failure; inside eval's argument it would not.
		expect(lines[app]).toMatch(/^APP_EXEC=\$\(node /);
	});

	it("never exports the superuser's credentials", () => {
		expect(script).not.toMatch(/export\s+POSTGRES/);
		expect(script).not.toMatch(/PGPASSWORD/);
	});

	it("drops the superuser's credentials from the shell right after that step", () => {
		const at = (needle: string) =>
			lines.findIndex((line) => line.includes(needle));
		const unset = lines.findIndex((line) =>
			/^unset\b.*POSTGRES_PASSWORD.*POSTGRES_USER/.test(line),
		);
		expect(unset).toBeGreaterThan(at("db-owner/cli.mjs prepare"));
		expect(unset).toBeLessThan(at("cli.mjs app-exec"));
		// The owner's URL replaces DATABASE_URL before that too.
		expect(at('export DATABASE_URL="$OWNER_DATABASE_URL"')).toBeLessThan(unset);
	});
});
