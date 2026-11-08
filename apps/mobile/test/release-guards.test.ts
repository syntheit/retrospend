/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = join(__dirname, "..", "scripts");
const read = (path: string) => readFileSync(path, "utf8");

// The release bundle check is only a guard while the release scripts run it.
describe("the release scripts run the bundle check", () => {
	it.each(["android-release.sh", "ios-archive.sh"])("%s", (name) => {
		expect(read(join(scripts, name))).toMatch(
			/^\s*bash "\$app\/scripts\/check-release-bundle\.sh" /m,
		);
	});
});

describe("the e2e link component name", () => {
	it("is the string the bundle check greps for", () => {
		const name = /E2eLink\.displayName = "(\w+)"/.exec(
			read(join(__dirname, "..", "src", "dev", "E2eLink.tsx")),
		)?.[1];
		expect(name).toBe("RetrospendE2eLink");
		expect(read(join(scripts, "check-release-bundle.sh"))).toContain(
			`grep -raql '${name}'`,
		);
	});
});

describe("check-release-bundle.sh", () => {
	// The script finds the app directory from its own path, so run a copy in
	// a throwaway tree with an empty bundle.
	function run(env: string | null, extraEnv: Record<string, string> = {}) {
		const app = mkdtempSync(join(tmpdir(), "release-guard-"));
		try {
			mkdirSync(join(app, "scripts"));
			mkdirSync(join(app, "dist"));
			copyFileSync(
				join(scripts, "check-release-bundle.sh"),
				join(app, "scripts", "check-release-bundle.sh"),
			);
			if (env !== null) writeFileSync(join(app, ".env.local"), env);
			const clean = Object.fromEntries(
				Object.entries(process.env).filter(
					([name]) => !name.startsWith("EXPO_PUBLIC_"),
				),
			);
			return spawnSync(
				"bash",
				[join(app, "scripts", "check-release-bundle.sh")],
				{
					encoding: "utf8",
					env: { ...clean, ...extraEnv } as NodeJS.ProcessEnv,
				},
			);
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	}

	it("passes a clean tree", () => {
		expect(run(null).status).toBe(0);
		expect(run("EXPO_PUBLIC_API_URL=x\n").status).toBe(0);
	});

	it.each([
		"EXPO_PUBLIC_E2E=1",
		"export EXPO_PUBLIC_E2E=1",
		"  export   EXPO_PUBLIC_E2E = 1",
		"EXPO_PUBLIC_DEV_EMAIL=a@b.c",
		"export EXPO_PUBLIC_DEV_EMAIL=a@b.c",
		"export EXPO_PUBLIC_GALLERY=1",
	])("fails on the .env line %j", (line) => {
		const result = run(`${line}\n`);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("dev variables in apps/mobile/.env*");
	});

	it("fails on the variable in the environment", () => {
		const result = run(null, { EXPO_PUBLIC_E2E: "1" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("EXPO_PUBLIC_E2E is set");
	});
});
