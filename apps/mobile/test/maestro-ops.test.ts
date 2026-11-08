/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The runner on vista shares one host with other work: a run may start and
// stop its own processes and nothing else (AGENTS.md section 10), and two
// runs must never take the same emulator slot (maestro-plan.md 1.3).
const ops = join(__dirname, "..", "maestro", "ops");
const scripts = readdirSync(ops).filter((name) => name.endsWith(".sh"));

describe("the Maestro runner scripts", () => {
	it.each(scripts)("%s parses", (name) => {
		const result = spawnSync("bash", ["-n", join(ops, name)], {
			encoding: "utf8",
		});
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});

	it.each(scripts)("%s never signals by name", (name) => {
		const code = readFileSync(join(ops, name), "utf8")
			.split("\n")
			.filter((line) => !line.trim().startsWith("#"))
			.join("\n");
		expect(code).not.toMatch(/\b(pkill|killall)\b/);
		expect(code).not.toMatch(/kill-server/);
	});
});

describe("the emulator pool", () => {
	let home: string;
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "rs-pool-"));
	});
	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	const bash = (script: string) =>
		spawnSync("bash", ["-c", script], {
			encoding: "utf8",
			timeout: 30_000,
			env: { ...process.env, HOME: home, POOL_POLL: "0.2" },
		});
	const prelude = `source '${join(ops, "pool.sh")}'; log() { :; }; T="$HOME"`;

	it("gives two runs two different slots and makes a third wait out its limit", () => {
		const result = bash(`${prelude}
			( take_slot a 5 && echo "$slot" >"$T/a"; sleep 4 ) &
			( take_slot b 5 && echo "$slot" >"$T/b"; sleep 4 ) &
			sleep 1.5
			take_slot c 1; echo "third=$?"
			wait
			echo "a=$(cat "$T/a") b=$(cat "$T/b")"`);
		expect(result.stdout).toContain("third=1");
		const [a, b] = /a=(\d) b=(\d)/.exec(result.stdout)?.slice(1) ?? [];
		expect(new Set([a, b])).toEqual(new Set(["0", "1"]));
	});

	it("frees a slot when its run ends even if a child is still alive", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=test
			pgdir=$T/slot; mkdir -p "$pgdir"
			( take_slot hold 5; sleep 6 ) &
			sleep 0.5
			( take_slot a 5; spawn child sleep 30; echo "$spawned" >"$T/child"; exit 0 )
			take_slot b 2 && echo "reused=$slot"
			kill_group "$(cat "$T/child")"
			sleep 0.3
			kill -0 "$(cat "$T/child")" 2>/dev/null && echo "child alive" || echo "child gone"`);
		// The first run's lock was only on its own shell, so a child it left
		// behind cannot hold the slot, and the next run finds a free one.
		expect(result.stdout).toMatch(/reused=[01]/);
		expect(result.stdout).toContain("child gone");
	});

	it("stops the recorded group and leaves other processes alone", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=test
			pgdir=$T/slot; mkdir -p "$pgdir"
			sleep 31 & other=$!
			spawn emulator sleep 32
			stop_slot_processes "$pgdir"
			sleep 0.3
			kill -0 "$spawned" 2>/dev/null && echo "own alive" || echo "own gone"
			kill -0 "$other" 2>/dev/null && echo "other alive" || echo "other gone"
			kill "$other"`);
		expect(result.stdout).toContain("own gone");
		expect(result.stdout).toContain("other alive");
	});

	it("leaves a stale pid alone when it is not a run's process", () => {
		const result = bash(`${prelude}
			unset RS_MAESTRO_RUN
			setsid sleep 31 & other=$!
			kill_group "$other"
			sleep 0.3
			kill -0 "$other" 2>/dev/null && echo "other alive" || echo "other gone"
			kill "$other"`);
		expect(result.stdout).toContain("other alive");
	});
});
