import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VARS = [
	"AUTH_SECRET",
	"BETTER_AUTH_SECRET",
	"DATABASE_URL",
	"SIDECAR_URL",
	"WORKER_URL",
	"IMPORTER_URL",
	"WORKER_API_KEY",
	"PUBLIC_URL",
	"NEXT_PUBLIC_APP_URL",
	"SHOW_LANDING_PAGE",
	"NEXT_PUBLIC_SHOW_LANDING_PAGE",
	"ENABLE_LEGAL_PAGES",
	"NEXT_PUBLIC_ENABLE_LEGAL_PAGES",
	"TRUSTED_ORIGINS",
	"OPENROUTER_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASSWORD",
	"EMAIL_FROM",
	"UPLOAD_DIR",
	"UNSUBSCRIBE_SECRET",
	"SKIP_ENV_VALIDATION",
];

async function loadEnv(vars: Record<string, string>) {
	for (const name of VARS) vi.stubEnv(name, undefined);
	vi.stubEnv("AUTH_SECRET", "secret");
	vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5434/retrospend");
	for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
	vi.resetModules();
	const mod = await import("~/env");
	return mod.env;
}

describe("env schema", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("fills defaults for a minimal setup", async () => {
		const env = await loadEnv({});

		expect(env.BETTER_AUTH_SECRET).toBe("secret");
		expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5434/retrospend");
		expect(env.SIDECAR_URL).toBe("http://retrospend-sidecar:8080");
		expect(env.UPLOAD_DIR).toBe("./uploads");
		expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:1997");
		expect(env.NEXT_PUBLIC_SHOW_LANDING_PAGE).toBe("false");
		expect(env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES).toBe("true");
		expect(env.PUBLIC_URL).toBeUndefined();
		expect(env.SMTP_PORT).toBeUndefined();
	});

	it("reads the docker-style names and coerces the SMTP port", async () => {
		const env = await loadEnv({
			PUBLIC_URL: "https://money.example.com",
			IMPORTER_URL: "http://importer:8080",
			SHOW_LANDING_PAGE: "true",
			ENABLE_LEGAL_PAGES: "false",
			SMTP_PORT: "587",
		});

		expect(env.PUBLIC_URL).toBe("https://money.example.com");
		expect(env.NEXT_PUBLIC_APP_URL).toBe("https://money.example.com");
		expect(env.SIDECAR_URL).toBe("http://importer:8080");
		expect(env.NEXT_PUBLIC_SHOW_LANDING_PAGE).toBe("true");
		expect(env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES).toBe("false");
		expect(env.SMTP_PORT).toBe(587);
	});

	it("treats empty strings as unset", async () => {
		const env = await loadEnv({ SIDECAR_URL: "", SMTP_HOST: "", UPLOAD_DIR: "" });

		expect(env.SIDECAR_URL).toBe("http://retrospend-sidecar:8080");
		expect(env.SMTP_HOST).toBeUndefined();
		expect(env.UPLOAD_DIR).toBe("./uploads");
	});

	it.each([
		["a database URL that is not a URL", { DATABASE_URL: "not a url" }],
		["a missing auth secret", { AUTH_SECRET: "" }],
		["an unknown landing page flag", { SHOW_LANDING_PAGE: "yes" }],
		["a public URL without a scheme", { PUBLIC_URL: "money.example.com" }],
		["a non-numeric SMTP port", { SMTP_PORT: "smtp" }],
	])("rejects %s", async (_label, vars) => {
		await expect(loadEnv(vars)).rejects.toThrow("Invalid environment variables");
	});
});
