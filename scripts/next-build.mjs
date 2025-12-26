import { spawn } from "node:child_process";

const prismaEnvKeys = [
	"PRISMA_SCHEMA_ENGINE_BINARY",
	"PRISMA_QUERY_ENGINE_BINARY",
	"PRISMA_QUERY_ENGINE_LIBRARY",
	"PRISMA_FMT_BINARY",
];

const env = { ...process.env };
for (const key of prismaEnvKeys) {
	delete env[key];
}

const args = ["build", ...process.argv.slice(2)];

const nextProcess = spawn("next", args, {
	env,
	stdio: "inherit",
});

nextProcess.on("error", (error) => {
	process.exit(1);
});

nextProcess.on("close", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
	} else {
		process.exit(code ?? 0);
	}
});
