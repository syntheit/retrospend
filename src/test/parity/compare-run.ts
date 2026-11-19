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
import { decodeCursor } from "../../server/services/api-v1/cursor";
import { syncCursorSchema } from "../../server/services/sync/changes";
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

/** The newest position any figures read of a check was taken at. */
export interface Seen {
	/** The `t` of the cursor in `basis.asOf`: the read's snapshot xmax minus one. */
	asOf: bigint | null;
}

export function proofApi(
	userId: string,
	alter?: Alter,
	seen?: Seen,
): DeviceApi {
	const client = rotatingClient(userId);
	return {
		...apiOver(client, sharesOf(userId)),
		figures: {
			read: async (query) => {
				const answer = await client.figures.read(query);
				// Decoded with the server's own decoder, so the format has one owner.
				const asOf = answer.basis
					? decodeCursor(answer.basis.asOf, syncCursorSchema)?.t
					: undefined;
				if (seen && asOf !== undefined) {
					const t = BigInt(asOf);
					if (seen.asOf === null || t > seen.asOf) seen.asOf = t;
				}
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
	/** The newest position the server's figures were read at. */
	position: bigint | null;
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
		const seen: Seen = { asOf: null };
		const engine = createDeviceEngine(
			proofApi(userId, options.alter, seen),
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
		return { reports, logs, position: seen.asOf };
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long the wait for a read's position takes at most, and how often it looks. */
const WAIT_DEADLINE_MS = 60_000;
const WAIT_POLL_MS = 500;
/** Checks made at most: each follows a wait for the position of the one before. */
const ROUNDS = 8;

/**
 * Positions are cluster-wide transaction ids, so a write transaction that
 * another worker's database holds open keeps every pull below the server's
 * read until it ends: the compare rightly says `behind`. A pull ends at the
 * snapshot's lowest running id minus one, so it reaches a read taken at `asOf`
 * (that read's xmax minus one) once the lowest running id is above `asOf`.
 * This waits for exactly that, and fails loudly, naming the oldest open id.
 */
async function waitPast(asOf: bigint): Promise<void> {
	const deadline = Date.now() + WAIT_DEADLINE_MS;
	for (;;) {
		const [row] = await adminDb.$queryRaw<{ xmin: string }[]>`
			SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`;
		if (row && BigInt(row.xmin) > asOf) return;
		// Date is faked only inside a check, so this is the real clock.
		if (Date.now() > deadline)
			throw new Error(
				`A write transaction stayed open for ${WAIT_DEADLINE_MS} ms: the oldest open id is ${row?.xmin}, the read was at ${asOf}`,
			);
		await sleep(WAIT_POLL_MS);
	}
}

const unsettled = (reports: readonly CompareReport[]) =>
	reports.some((r) => r.behind > 0 || r.skipped === "moving");

const summarize = (reports: readonly CompareReport[]) =>
	`behind: ${reports.filter((r) => r.behind > 0).length} screens, moving: ${reports.filter((r) => r.skipped === "moving").length} screens\n${reports.map((r) => compareLine(r)).join("\n")}`;

/**
 * `checkOnce`; a check that found the device behind the server's read, or the
 * rows still moving, waits until a pull can pass that read's position
 * (waitPast) and is made again. It never returns such a report: when none
 * settles within ROUNDS, it throws with the report of every attempt.
 */
export async function checkAt(
	clock: Date,
	userId: string,
	checks: readonly Check[],
	options: { browserZone: string; alter?: Alter },
): Promise<Checked> {
	const attempts: string[] = [];
	for (let i = 0; i < ROUNDS; i++) {
		const done = await checkOnce(clock, userId, checks, options);
		if (!unsettled(done.reports)) return done;
		attempts.push(summarize(done.reports));
		if (done.position !== null) await waitPast(done.position);
	}
	throw new Error(
		`The device did not settle in ${ROUNDS} checks:\n${attempts.join("\n--\n")}`,
	);
}
