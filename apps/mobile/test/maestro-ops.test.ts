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

// A flow's own `env:` wins over the runner's `-e SERVER=...`. A flow that pins
// a server sends the app of slot 1 to the server of slot 0, which breaks the
// isolation of the pool (and fails once that other run is over).
describe("the flows", () => {
	const flows = join(__dirname, "..", "maestro", "flows");
	it.each(readdirSync(flows))("%s leaves SERVER to the runner", (name) => {
		expect(readFileSync(join(flows, name), "utf8")).not.toMatch(/^\s+SERVER:/m);
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
			kill_group "$(cat "$T/child")" test
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

	it("leaves a group alone when it is not this slot's run", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=someone-else
			setsid sleep 31 & other=$!
			sleep 0.2
			kill_group "$other" this-run
			sleep 0.3
			kill -0 "$other" 2>/dev/null && echo "other alive" || echo "other gone"
			unset RS_MAESTRO_RUN
			setsid sleep 32 & bare=$!
			sleep 0.2
			kill_group "$bare" this-run
			kill -0 "$bare" 2>/dev/null && echo "bare alive" || echo "bare gone"
			kill "$other" "$bare"`);
		expect(result.stdout).toContain("other alive");
		expect(result.stdout).toContain("bare alive");
	});

	it("takes a postmaster for this slot's only when its command line names the directory", () => {
		const result = bash(`${prelude}
			d=$T/slot; mkdir -p "$d/data"
			sleep 31 & plain=$!
			echo "$plain" >"$d/data/postmaster.pid"
			postgres_alive "$d" && echo "plain=yes" || echo "plain=no"
			( exec -a "postgres -D $d/data" bash -c 'sleep 32; :' ) & real=$!
			sleep 0.3
			echo "$real" >"$d/data/postmaster.pid"
			postgres_alive "$d" && echo "real=yes" || echo "real=no"
			( exec -a "postgres -D /elsewhere/data" bash -c 'sleep 33; :' ) & other=$!
			sleep 0.3
			echo "$other" >"$d/data/postmaster.pid"
			postgres_alive "$d" && echo "other=yes" || echo "other=no"
			kill "$plain" "$real" "$other"`);
		expect(result.stdout).toContain("plain=no");
		expect(result.stdout).toContain("real=yes");
		expect(result.stdout).toContain("other=no");
	});

	it("reports a postmaster that will not stop and leaves its directory", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=test POOL_PG_STOP_TRIES=3
			d=$T/slot; mkdir -p "$d/data"
			( trap '' INT; exec -a "postgres -D $d/data" bash -c 'sleep 34; :' ) & pm=$!
			sleep 0.3
			echo "$pm" >"$d/data/postmaster.pid"
			stop_slot_processes "$d"; echo "rc=$?"
			test -d "$d/data" && echo "dir kept"
			kill -KILL "$pm"`);
		expect(result.stdout).toContain("rc=1");
		expect(result.stdout).toContain("dir kept");
	});
});

// Every wait is bounded: a run that cannot proceed fails with a message and
// lets go of its slot instead of holding it for good.
describe("the waits", () => {
	const read = (name: string) => readFileSync(join(ops, name), "utf8");
	it("avd-base.sh bounds the emulator wait and holds a lock", () => {
		const code = read("avd-base.sh");
		expect(code).toMatch(/timeout \d+ adb -s "\$serial" wait-for-device/);
		expect(code).toMatch(/SECONDS < deadline/);
		expect(code).toMatch(/flock -n 6/);
	});
	it("run.sh bounds the memory wait", () => {
		expect(read("run.sh")).toMatch(/SECONDS < mem_deadline/);
	});
	it("maestro.sh keeps every .env file off the shared host", () => {
		expect(read("maestro.sh")).toContain("--exclude '.env*'");
	});
	it("maestro.sh deletes the remote directory only after the copy-back", () => {
		expect(read("maestro.sh")).toMatch(
			/if rsync [^\n]*maestro-results[^\n]*; then\n\tremote_cleanup/,
		);
	});
});
