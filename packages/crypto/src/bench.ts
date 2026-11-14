// The F4 benchmark core: how long Argon2id and a bulk open take on this
// device, so the real parameters can be fixed from measured numbers. Pure
// apart from the primitives and the clock it is given; the dev screens on the
// web and the phone only render what it returns. It uses synthetic records, no
// user data.
import { type Json, openRecord, type RecordKey, sealRecord } from "./format";
import { toHex } from "./hex";
import { generateCollectionKey } from "./keys";
import type { Argon2Params, Primitives } from "./primitives";

/** The plan's default first (64 MiB, 3 passes), then what to compare it to. */
export const BENCH_ARGON2_SETS: readonly Argon2Params[] = [
	{ memoryKiB: 64 * 1024, passes: 3 },
	{ memoryKiB: 32 * 1024, passes: 3 },
	{ memoryKiB: 64 * 1024, passes: 2 },
	{ memoryKiB: 128 * 1024, passes: 3 },
];

/** About 25,000 records: what a 10,000 expense account seals in all. */
export const BENCH_RECORDS = 25_000;
export const BENCH_RUNS = 5;

export interface BenchOptions {
	/** Milliseconds, monotonic (performance.now). */
	now: () => number;
	runs?: number;
	argon2Sets?: readonly Argon2Params[];
	records?: number;
	/** Lets a screen repaint; it runs before each step. */
	pause?: () => Promise<void>;
	/** Called before each step with its row label. */
	onStep?: (label: string) => void;
}

export interface Argon2Result extends Argon2Params {
	runs: number;
	medianMs: number;
	maxMs: number;
}

export interface RecordsResult {
	records: number;
	sealMs: number;
	openMs: number;
	openPerRecordMs: number;
}

export interface BenchReport {
	argon2: Argon2Result[];
	records: RecordsResult;
}

export interface BenchRow {
	label: string;
	value: string;
}

/** 25000 becomes "25,000". Plain digits, so no locale code is involved. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
const argon2Label = (p: Argon2Params) =>
	`Argon2id ${p.memoryKiB / 1024} MiB, ${p.passes} passes`;
const openLabel = (count: number) => `Open ${grouped(count)} records`;
const ms = (value: number) => Math.round(value * 10) / 10;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2
		? (sorted[mid] as number)
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function benchArgon2(
	p: Primitives,
	params: Argon2Params,
	runs: number,
	now: () => number,
): Argon2Result {
	const password = p.randomBytes(16);
	const salt = p.randomBytes(16);
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const start = now();
		p.wipe(p.argon2id(password, salt, params));
		times.push(now() - start);
	}
	return {
		...params,
		runs,
		medianMs: median(times),
		maxMs: Math.max(...times),
	};
}

/** An expense-shaped record, a few hundred bytes once padded, like the plan's. */
function sampleRecord(i: number): { [key: string]: Json } {
	return {
		id: `rec${i}`,
		title: `Sample expense number ${i}`,
		amount: { minor: 100_000 + i, currency: "ARS" },
		home: { minor: 1_000 + (i % 977), currency: "USD" },
		date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
		categoryId: `cat${i % 20}`,
		projectId: i % 5 === 0 ? `prj${i % 7}` : null,
		notes: "Synthetic note text to give the record a realistic size.",
		splits: [
			{ personId: `per${i % 9}`, minor: 50_000 },
			{ personId: "self", minor: 50_000 + i },
		],
	};
}

export function benchRecords(
	p: Primitives,
	count: number,
	now: () => number,
): RecordsResult {
	const recordKey: RecordKey = generateCollectionKey(p);
	const ctx = (i: number) => ({
		userId: "bench_user",
		collectionId: "bench",
		entity: 1,
		recordId: `rec${i}`,
		version: 1,
	});
	const sealed: Uint8Array[] = [];
	const sealStart = now();
	for (let i = 0; i < count; i++) {
		sealed.push(sealRecord(p, recordKey, ctx(i), 1, sampleRecord(i)));
	}
	const sealMs = now() - sealStart;
	const keyHex = toHex(recordKey.keyId);
	const find = (id: Uint8Array) =>
		toHex(id) === keyHex ? recordKey.key : undefined;
	const openStart = now();
	for (let i = 0; i < count; i++) {
		openRecord(p, find, ctx(i), sealed[i] as Uint8Array);
	}
	const openMs = now() - openStart;
	p.wipe(recordKey.key);
	return {
		records: count,
		sealMs,
		openMs,
		openPerRecordMs: count > 0 ? openMs / count : 0,
	};
}

export async function runCryptoBench(
	p: Primitives,
	options: BenchOptions,
): Promise<BenchReport> {
	const { now, runs = BENCH_RUNS, records = BENCH_RECORDS } = options;
	const pause = options.pause ?? (() => Promise.resolve());
	const argon2: Argon2Result[] = [];
	for (const params of options.argon2Sets ?? BENCH_ARGON2_SETS) {
		options.onStep?.(argon2Label(params));
		await pause();
		argon2.push(benchArgon2(p, params, runs, now));
	}
	options.onStep?.(openLabel(records));
	await pause();
	return { argon2, records: benchRecords(p, records, now) };
}

/** The plain rows a screen shows. `note` names the thread, where it matters. */
export function benchRows(report: BenchReport, note = ""): BenchRow[] {
	const r = report.records;
	return [
		...report.argon2.map((a) => ({
			label: argon2Label(a),
			value: `${ms(a.medianMs)} ms median, ${ms(a.maxMs)} ms max`,
		})),
		{
			label: openLabel(r.records) + note,
			value: `${ms(r.openMs)} ms, ${Math.round(r.openPerRecordMs * 1000)} us each`,
		},
		{
			label: `Seal ${grouped(r.records)} records${note}`,
			value: `${ms(r.sealMs)} ms`,
		},
	];
}

/** One line of JSON to paste into the spike doc. `env` names device and OS. */
export function benchJson(
	env: Record<string, string>,
	report: BenchReport,
): string {
	return JSON.stringify({
		...env,
		argon2: report.argon2.map((a) => ({
			memoryMiB: a.memoryKiB / 1024,
			passes: a.passes,
			runs: a.runs,
			medianMs: ms(a.medianMs),
			maxMs: ms(a.maxMs),
		})),
		records: {
			count: report.records.records,
			sealMs: ms(report.records.sealMs),
			openMs: ms(report.records.openMs),
			openPerRecordUs: Math.round(report.records.openPerRecordMs * 1000),
		},
	});
}
