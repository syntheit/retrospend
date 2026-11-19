/**
 * The device engine's own compare, run against the real v1 routes: the engine
 * the phone and the web worker run (createDeviceEngine), pulling through the
 * sync routes and asking GET /figures for the server's figures and their
 * basis, over the handler the Next route uses, as a mobile app session. What
 * stays here is plumbing: sessions that rotate (one session takes 300
 * requests a minute and a check makes dozens), the fake clock around a run,
 * and a way to alter what the server answers, for the cases a real server
 * never produces.
 */
import {
	createRetrospendClient,
	type RetrospendClient,
} from "@retrospend/api-client";
import { vi } from "vitest";
import {
	type CompareReport,
	compareLine,
	createDeviceEngine,
	type DeviceApi,
	type FigureNarrowing,
	type NarrowValues,
	type ScreenName,
	type ServerFigures,
} from "../../../packages/engine/src/device/index";
import { handleV1Request } from "../../server/api/v1/handler";
import { adminDb } from "../pg-harness";
import { apiOver, freshIp, longSession, sharesOf } from "./pull";

/** A session takes 300 requests a minute; this leaves room. */
const SESSION_REQUESTS = 80;

/** A client whose requests move to a new session every SESSION_REQUESTS, answered in process. */
function rotatingClient(userId: string): RetrospendClient {
	let token = "";
	let used = SESSION_REQUESTS;
	return createRetrospendClient({
		baseUrl: "http://localhost:3101",
		fetch: async (input, init) => {
			if (used >= SESSION_REQUESTS) {
				token = await longSession(userId);
				used = 0;
			}
			used += 1;
			const request = new Request(input, init);
			request.headers.set("authorization", `Bearer ${token}`);
			for (const [name, value] of Object.entries(freshIp()))
				request.headers.set(name, value);
			return handleV1Request(request);
		},
	});
}

/** Changes the server's answer to one figures read, as a stand-in for a server that is wrong. */
export type Alter = (
	answer: ServerFigures,
	query: { ids: string } & FigureNarrowing,
) => ServerFigures;

export function proofApi(userId: string, alter?: Alter): DeviceApi {
	const client = rotatingClient(userId);
	return {
		...apiOver(client, sharesOf(userId)),
		figures: {
			read: async (query) => {
				const answer = await client.figures.read(query);
				return alter ? alter(answer, query) : answer;
			},
		},
	};
}

/** Runs `fn` with Date at `clock`: the server's figures, the owed totals and the engine all read it. */
export async function atClock<T>(
	clock: Date,
	fn: () => Promise<T>,
): Promise<T> {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(clock);
	try {
		return await fn();
	} finally {
		vi.useRealTimers();
	}
}

export interface Check {
	screen: ScreenName;
	values?: NarrowValues;
}

export interface Checked {
	reports: CompareReport[];
	/** Everything the engine logged, in order. */
	logs: string[];
}

/**
 * One engine, signed in as `userId`, checks each screen in turn at `clock`
 * (its first check makes the first pull). `browserZone` is the zone the
 * client would render in.
 */
async function checkOnce(
	clock: Date,
	userId: string,
	checks: readonly Check[],
	options: { browserZone: string; alter?: Alter },
): Promise<Checked> {
	return atClock(clock, async () => {
		const logs: string[] = [];
		const engine = createDeviceEngine(
			proofApi(userId, options.alter),
			userId,
			Date.now,
			{
				warn: (what, detail) => logs.push(`${what} ${detail ?? ""}`.trim()),
				browserZone: () => options.browserZone,
			},
		);
		const reports: CompareReport[] = [];
		try {
			for (const check of checks) {
				const report = await engine.compare(check.screen, check.values);
				if (!report)
					throw new Error(
						`${check.screen}: the check could not run\n${logs.join("\n")}`,
					);
				reports.push(report);
			}
		} finally {
			await engine.dispose({ wipe: false });
		}
		return { reports, logs };
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a check waits for the cluster to have no write transaction open, and how often it looks. */
const QUIET_DEADLINE_MS = 60_000;
const QUIET_POLL_MS = 500;
/** Checks made, each after a quiet moment: a transaction can open between the wait and the server's read. */
const ATTEMPTS = 3;

/**
 * Positions are cluster-wide transaction ids, so a write transaction that
 * another worker's database holds open keeps every pull below the server's
 * read until it ends: the compare rightly says `behind`. This waits until no
 * write transaction is open anywhere in the cluster (the snapshot's lowest
 * running id is its next id), so the check that follows starts with nothing
 * older than its read in the way. Fails loudly, naming the oldest open id.
 */
async function waitForQuiet(): Promise<void> {
	const deadline = Date.now() + QUIET_DEADLINE_MS;
	for (;;) {
		const [row] = await adminDb.$queryRaw<{ xmin: string; xmax: string }[]>`
			SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin,
			       pg_snapshot_xmax(pg_current_snapshot())::text AS xmax`;
		if (row && row.xmin === row.xmax) return;
		// Date is faked only inside a check, so this is the real clock.
		if (Date.now() > deadline)
			throw new Error(
				`A write transaction stayed open for ${QUIET_DEADLINE_MS} ms: the oldest open id is ${row?.xmin}, the next id ${row?.xmax}`,
			);
		await sleep(QUIET_POLL_MS);
	}
}

const unsettled = (reports: readonly CompareReport[]) =>
	reports.some((r) => r.behind > 0 || r.skipped === "moving");

/**
 * `checkOnce` after a quiet moment (waitForQuiet). A check that still found the
 * device behind, because a transaction opened in between, is made again after
 * another quiet moment, up to ATTEMPTS times. It never returns such a report:
 * when none settles, it throws with the report of every attempt.
 */
export async function checkAt(
	clock: Date,
	userId: string,
	checks: readonly Check[],
	options: { browserZone: string; alter?: Alter },
): Promise<Checked> {
	const attempts: string[] = [];
	for (let i = 0; i < ATTEMPTS; i++) {
		await waitForQuiet();
		const done = await checkOnce(clock, userId, checks, options);
		if (!unsettled(done.reports)) return done;
		attempts.push(done.reports.map((r) => compareLine(r)).join("\n"));
	}
	throw new Error(
		`The device stayed behind the server's read in ${ATTEMPTS} checks:\n${attempts.join("\n--\n")}`,
	);
}
