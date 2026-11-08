// The entrypoint runs as the app's own user (nextjs) while it holds the
// database superuser's credentials. A container restart keeps its writable
// layer, so if the app could rewrite a file the entrypoint runs, code running
// in the app could read the superuser's URL at the next start. Everything the
// entrypoint runs must therefore be root-owned and not writable by nextjs.
//
// This reads the Dockerfile; no image is built. The check on a built image is
// scripts/check-entrypoint-perms.sh, run as the image's default user:
//   docker run --rm --entrypoint sh <image> scripts/check-entrypoint-perms.sh
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./uiRules/paths";

const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));
/** Instructions with continuation lines joined. */
const instructions = runner
	.replace(/\\\n/g, " ")
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => line !== "" && !line.startsWith("#"));

/** What the entrypoint or the scripts it calls read or run, as COPY destinations. */
const ROOT_OWNED = [
	"node_modules",
	"prisma/",
	"prisma.config.ts",
	"scripts/",
	"docker-entrypoint.sh",
	"package.json",
];

describe("Dockerfile runner stage", () => {
	it("copies every file the entrypoint runs without --chown, so it stays root-owned", () => {
		for (const dest of ROOT_OWNED) {
			const copies = instructions.filter(
				(line) => line.startsWith("COPY ") && line.includes(dest),
			);
			expect(copies.length, dest).toBeGreaterThan(0);
			for (const copy of copies) {
				expect(copy, dest).not.toMatch(/--chown/);
			}
		}
	});

	it("fixes ownership and write bits of those paths after the last copy into them", () => {
		const lastCopy = Math.max(
			...instructions.map((line, i) =>
				line.startsWith("COPY ") && ROOT_OWNED.some((d) => line.includes(d))
					? i
					: -1,
			),
		);
		const fix = instructions.findIndex(
			(line, i) =>
				i > lastCopy &&
				line.startsWith("RUN ") &&
				line.includes("chown -h root:root") &&
				line.includes("chmod go-w"),
		);
		expect(fix).toBeGreaterThan(lastCopy);
		const line = instructions[fix] ?? "";
		for (const path of [
			"/app/node_modules",
			"/app/prisma ",
			"/app/scripts",
			"/app/prisma.config.ts",
			"/app/docker-entrypoint.sh",
		]) {
			expect(line, path).toContain(path);
		}
	});

	it("switches to nextjs only after that, and never hands those paths back", () => {
		const user = instructions.indexOf("USER nextjs");
		const fix = instructions.findIndex((line) =>
			line.includes("chown -h root:root"),
		);
		expect(fix).toBeGreaterThan(-1);
		expect(user).toBeGreaterThan(fix);
		const handedBack = instructions.filter(
			(line) =>
				/chown\b.*\bnextjs/.test(line) &&
				ROOT_OWNED.some((d) => line.includes(d)),
		);
		expect(handedBack).toEqual([]);
	});

	it("keeps only the app's own code writable by nextjs", () => {
		const chowned = instructions
			.filter((line) => line.startsWith("COPY ") && line.includes("--chown"))
			.map((line) => line.split(/\s+/).at(-1));
		expect(chowned.sort()).toEqual(
			["./", "./.next/static", "./generated", "./packages", "./src"].sort(),
		);
	});
});
