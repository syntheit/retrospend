import { describe, expect, it } from "vitest";
import { capHostOf, type Limits, runWithLimits, type Slot } from "./pool";

type Job = Slot & { name: string };

const tick = () => new Promise((r) => setTimeout(r, 0));
const job = (name: string, user: string, host: string | null = null): Job => ({
	name,
	user,
	host,
});

/** Jobs that stay running until the test lets them go, so concurrency can be read. */
function harness(limits: Limits, jobs: Job[]) {
	const gates = new Map<string, () => void>();
	const started: string[] = [];
	const running = new Set<Job>();
	let peak = 0;
	const peakUser = new Map<string, number>();
	const peakHost = new Map<string, number>();
	const raise = (map: Map<string, number>, key: string, n: number) =>
		map.set(key, Math.max(map.get(key) ?? 0, n));

	let settled = false;
	const done = runWithLimits(
		jobs,
		(j) => j,
		limits,
		(j) => {
			started.push(j.name);
			running.add(j);
			peak = Math.max(peak, running.size);
			const all = [...running];
			raise(peakUser, j.user, all.filter((x) => x.user === j.user).length);
			if (j.host)
				raise(peakHost, j.host, all.filter((x) => x.host === j.host).length);
			return new Promise<void>((resolve) => {
				gates.set(j.name, () => {
					running.delete(j);
					resolve();
				});
			});
		},
	).finally(() => {
		settled = true;
	});

	return {
		started,
		done,
		peak: () => peak,
		peakUser,
		peakHost,
		release: (name: string) => gates.get(name)?.(),
		/** Lets every running job finish, again and again, until the pool is done. */
		async drain() {
			while (!settled) {
				for (const [name, open] of [...gates]) {
					gates.delete(name);
					open();
				}
				await tick();
			}
			await done;
		},
	};
}

describe("runWithLimits", () => {
	it("never runs more than the total at once, and runs everything", async () => {
		const jobs = Array.from({ length: 12 }, (_, i) => job(`j${i}`, `u${i}`));
		const h = harness({ total: 3, perUser: 3, perHost: 3 }, jobs);
		await tick();
		expect(h.started).toHaveLength(3);
		await h.drain();
		expect(h.started).toHaveLength(12);
		expect(h.peak()).toBe(3);
	});

	it("keeps one user to their share, so others still get a slot", async () => {
		const jobs = [
			job("a1", "A"),
			job("a2", "A"),
			job("a3", "A"),
			job("a4", "A"),
			job("b1", "B"),
		];
		const h = harness({ total: 3, perUser: 2, perHost: 3 }, jobs);
		await tick();
		// A holds two slots; the third goes to B, past A's waiting jobs.
		expect(h.started).toEqual(["a1", "a2", "b1"]);
		await h.drain();
		expect(h.peakUser.get("A")).toBe(2);
		expect(h.started).toHaveLength(5);
	});

	it("keeps one host to its share across users", async () => {
		const jobs = [
			job("x1", "A", "evil.example"),
			job("x2", "B", "evil.example"),
			job("x3", "C", "evil.example"),
			job("ok", "D", "ntfy.sh"),
		];
		const h = harness({ total: 5, perUser: 5, perHost: 2 }, jobs);
		await tick();
		expect(h.started).toEqual(["x1", "x2", "ok"]);
		h.release("x1");
		await tick();
		expect(h.started).toEqual(["x1", "x2", "ok", "x3"]);
		await h.drain();
		expect(h.peakHost.get("evil.example")).toBe(2);
	});

	it("starts a waiting job as soon as the slot it needs frees up", async () => {
		const jobs = [job("a1", "A"), job("a2", "A"), job("a3", "A")];
		const h = harness({ total: 5, perUser: 1, perHost: 5 }, jobs);
		await tick();
		expect(h.started).toEqual(["a1"]);
		h.release("a1");
		await tick();
		expect(h.started).toEqual(["a1", "a2"]);
		await h.drain();
	});

	it("frees the slot when a job fails, finishes the rest, then reports the first failure", async () => {
		const ran: string[] = [];
		const jobs = [job("a", "A"), job("b", "A"), job("c", "A")];
		await expect(
			runWithLimits(
				jobs,
				(j) => j,
				{ total: 1, perUser: 1, perHost: 1 },
				async (j) => {
					ran.push(j.name);
					if (j.name === "a") throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");
		expect(ran).toEqual(["a", "b", "c"]);
	});

	it("resolves at once for no jobs", async () => {
		await runWithLimits(
			[],
			(j: Job) => j,
			{ total: 1, perUser: 1, perHost: 1 },
			async () => {},
		);
	});
});

describe("capHostOf", () => {
	it("counts subdomains under their registered domain", () => {
		expect(capHostOf("https://a.evil.example/up/1")).toBe("evil.example");
		expect(capHostOf("https://B.Evil.Example./up/2")).toBe("evil.example");
		expect(capHostOf("https://ntfy.sh/topic")).toBe("ntfy.sh");
	});

	it("keeps an address as it is", () => {
		expect(capHostOf("http://10.0.0.5:8080/x")).toBe("10.0.0.5");
		expect(capHostOf("http://[2001:db8::1]/x")).toBe("[2001:db8::1]");
	});

	it("has no host for something that is not a URL", () => {
		expect(capHostOf(null)).toBeNull();
		expect(capHostOf("not a url")).toBeNull();
	});
});
