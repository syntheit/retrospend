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
	// Every wait below is on an event (a file, a process state), never on a
	// stretch of wall-clock time: a loaded host can starve any child for longer
	// than any fixed sleep. await only bounds the wait so a broken run fails
	// instead of hanging, far above anything a loaded host needs.
	const prelude = `source '${join(ops, "pool.sh")}'; log() { :; }; T="$HOME"
		await() { local i; for i in $(seq 1 600); do "$@" && return 0; sleep 0.05; done; return 1; }
		alive() { local s; s=$(awk -F') ' '{print substr($NF,1,1)}' "/proc/$1/stat" 2>/dev/null); [[ -n $s && $s != Z ]]; }
		gone() { ! alive "$1"; }
		isgroup() { kill -0 -- "-$1" 2>/dev/null; }
		cmd_has() { tr '\\0' ' ' <"/proc/$1/cmdline" 2>/dev/null | grep -qF -- "$2"; }`;

	it("gives two runs two different slots and makes a third wait out its limit", () => {
		const result = bash(`${prelude}
			( take_slot a 5 && echo "$slot" >"$T/a"; await test -e "$T/release" ) &
			( take_slot b 5 && echo "$slot" >"$T/b"; await test -e "$T/release" ) &
			await test -e "$T/a"; await test -e "$T/b"
			take_slot c 1; echo "third=$?"
			touch "$T/release"
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
			( take_slot hold 5; touch "$T/held"; await test -e "$T/release" ) &
			await test -e "$T/held"
			( take_slot a 5; spawn child sleep 30; echo "$spawned" >"$T/child"; exit 0 )
			take_slot b 2 && echo "reused=$slot"
			kill_group "$(cat "$T/child")" test
			await gone "$(cat "$T/child")" && echo "child gone" || echo "child alive"
			touch "$T/release"
			wait`);
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
			alive "$spawned" && echo "own alive" || echo "own gone"
			alive "$other" && echo "other alive" || echo "other gone"
			kill "$other"`);
		expect(result.stdout).toContain("own gone");
		expect(result.stdout).toContain("other alive");
	});

	// A starved child can take seconds to reach setsid. Until then its group
	// does not exist, and a stop that came first used to find nothing and
	// leave the child running. The stub makes that starvation certain.
	it("stops a child that is slow to reach setsid", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=test
			pgdir=$T/slot; mkdir -p "$pgdir" "$T/bin"
			printf '#!/usr/bin/env bash\\nsleep 1\\nexec %s "$@"\\n' "$(command -v setsid)" >"$T/bin/setsid"
			chmod +x "$T/bin/setsid"
			PATH="$T/bin:$PATH"
			spawn emulator sleep 32
			stop_slot_processes "$pgdir"
			alive "$spawned" && echo "own alive" || echo "own gone"
			kill -KILL "$spawned" 2>/dev/null`);
		expect(result.stdout).toContain("own gone");
	});

	it("leaves a group alone when it is not this slot's run", () => {
		const result = bash(`${prelude}
			export RS_MAESTRO_RUN=someone-else
			setsid sleep 31 & other=$!
			await isgroup "$other"
			kill_group "$other" this-run
			alive "$other" && echo "other alive" || echo "other gone"
			unset RS_MAESTRO_RUN
			setsid sleep 32 & bare=$!
			await isgroup "$bare"
			kill_group "$bare" this-run
			alive "$bare" && echo "bare alive" || echo "bare gone"
			kill "$other" "$bare"`);
		expect(result.stdout).toContain("other alive");
		expect(result.stdout).toContain("bare alive");
	});

	it("takes a postmaster for this slot's only when its command line names the directory", () => {
		const result = bash(`${prelude}
			d=$T/slot; mkdir -p "$d/data"
			sleep 31 & plain=$!
			await cmd_has "$plain" "sleep 31"
			echo "$plain" >"$d/data/postmaster.pid"
			postgres_alive "$d" && echo "plain=yes" || echo "plain=no"
			( exec -a "postgres -D $d/data" bash -c 'sleep 32; :' ) >/dev/null 2>&1 & real=$!
			await cmd_has "$real" "postgres -D $d/data"
			echo "$real" >"$d/data/postmaster.pid"
			postgres_alive "$d" && echo "real=yes" || echo "real=no"
			( exec -a "postgres -D /elsewhere/data" bash -c 'sleep 33; :' ) >/dev/null 2>&1 & other=$!
			await cmd_has "$other" "postgres -D /elsewhere/data"
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
			( trap '' INT; exec -a "postgres -D $d/data" bash -c 'sleep 34; :' ) >/dev/null 2>&1 & pm=$!
			await cmd_has "$pm" "postgres -D $d/data"
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
