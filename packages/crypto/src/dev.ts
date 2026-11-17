// Dev and test entry: the benchmark and the known-answer self-test, with the
// vectors they carry (about 30 KB). Not in the production entry, so a sign-in
// never loads them. Used by the benchmark screens and the platform vector tests.
export {
	type Argon2Entry,
	type Argon2Result,
	BENCH_ARGON2_SETS,
	BENCH_RECORDS,
	BENCH_RUNS,
	type BenchOptions,
	type BenchReport,
	type BenchRow,
	benchJson,
	benchRows,
	type RecordsEntry,
	type RecordsResult,
	runCryptoBench,
	type StepFailure,
} from "./bench";
export { runKnownAnswerTests } from "./self-test";
