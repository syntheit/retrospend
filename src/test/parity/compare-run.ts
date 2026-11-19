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
	createDeviceEngine,
	type DeviceApi,
	type FigureNarrowing,
	type NarrowValues,
	type ScreenName,
	type ServerFigures,
} from "../../../packages/engine/src/device/index";
import { handleV1Request } from "../../server/api/v1/handler";
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

/** How many times a check that found the device behind is made again, and the wait between. */
const SETTLE_TRIES = 12;
const SETTLE_MS = 1_000;

/**
 * `checkOnce`, made again (a new engine each time) while a screen found the
 * device behind the server's read or the rows still moving. Positions are
 * cluster-wide transaction ids, so a transaction another worker's database
 * holds open keeps every pull below the read until it ends: the compare is
 * right to say `behind`, and a test that wants a real answer waits for it. The
 * last attempt is returned, whatever it found.
 */
export async function checkAt(
	clock: Date,
	userId: string,
	checks: readonly Check[],
	options: { browserZone: string; alter?: Alter },
): Promise<Checked> {
	let last = await checkOnce(clock, userId, checks, options);
	for (let i = 1; i < SETTLE_TRIES && notSettled(last.reports); i++) {
		await sleep(SETTLE_MS);
		last = await checkOnce(clock, userId, checks, options);
	}
	return last;
}

const notSettled = (reports: readonly CompareReport[]) =>
	reports.some((r) => r.behind > 0 || r.skipped === "moving");
