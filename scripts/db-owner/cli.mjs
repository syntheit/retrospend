// Command line for scripts/db-owner/index.mjs.
//
//   prepare     The start's database work. Reads DATABASE_URL (and
//               DATABASE_OWNER_PASSWORD). With a superuser URL it creates the
//               owner role and hands it the objects, runs the migrations as
//               the owner (the owner holds CREATE on the database for that
//               long only), applies the grants file as the owner, and prints
//               the owner's URL on stdout, and nothing else there. With any
//               other URL it migrates and applies the grants as given and
//               prints nothing. Messages and the tools' output go to stderr.
//               docker-entrypoint.sh uses this.
//   app-exec    Prints a shell line that puts `env -i NAME=value ...` in front
//               of the positional parameters, for the entrypoint's final exec.
//   run         For local development (pnpm dev, pnpm dev:test): the same
//               preparation (the grants file only with --grants), then the rest
//               of the command line with the owner's URL as DATABASE_URL.
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import {
	buildAppEnv,
	PROJECT_ROOT,
	prepare,
	shellExecPrefix,
} from "./index.mjs";

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} grants
 * @returns {Promise<{ url: string, switched: boolean }>}
 */
async function prepareDatabase(env, grants) {
	const url = env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is not set");
	const { url: next, result } = await prepare(url, {
		ownerPassword: env.DATABASE_OWNER_PASSWORD,
		grants,
	});
	if (result.status === "switched") {
		console.error(
			`Database: connecting as retrospend_owner (${result.changedObjects} objects handed over)`,
		);
	} else {
		console.error(
			`Database: connecting with DATABASE_URL as given (${result.reason})`,
		);
	}
	return { url: next, switched: result.status === "switched" };
}

async function main() {
	const [command, ...rest] = process.argv.slice(2);

	if (command === "prepare") {
		// The entrypoint always applied the grants file after the migrations.
		const { url, switched } = await prepareDatabase(process.env, true);
		// Print only a URL that differs: nothing means "keep yours".
		if (switched) process.stdout.write(`${url}\n`);
		return;
	}

	if (command === "app-exec") {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) throw new Error("DATABASE_URL is not set");
		const { env, dropped } = buildAppEnv(process.env, databaseUrl);
		if (dropped.length > 0) {
			console.error(
				`Not passed to the app (names only; add one to APP_ENV_NAMES in scripts/db-owner/index.mjs if the app reads it): ${dropped.join(", ")}`,
			);
		}
		process.stdout.write(`${shellExecPrefix(env)}\n`);
		return;
	}

	if (command === "run") {
		const split = rest.indexOf("--");
		const flags = split === -1 ? [] : rest.slice(0, split);
		const argv = split === -1 ? rest : rest.slice(split + 1);
		const [program, ...args] = argv;
		if (!program) throw new Error("Usage: cli.mjs run [--grants] -- <command>");

		// Next and Prisma read these files themselves; this script needs the
		// URL first. Files never override what the shell already set.
		dotenv.config({ path: [".env.local", ".env"], quiet: true });
		const { url } = await prepareDatabase(
			process.env,
			flags.includes("--grants"),
		);
		const env = { ...process.env, DATABASE_URL: url };

		const child = spawn(program, args, {
			env,
			stdio: "inherit",
			cwd: PROJECT_ROOT,
		});
		for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
			process.on(signal, () => child.kill(signal));
		}
		child.on("exit", (code, signal) => {
			process.exit(code ?? (signal ? 1 : 0));
		});
		return;
	}

	throw new Error(
		"Usage: cli.mjs prepare | app-exec | run [--grants] -- <command>",
	);
}

main().catch((error) => {
	console.error(`db-owner: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
