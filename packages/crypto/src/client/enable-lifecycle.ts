// When the enable sheet's draft (the keys makeKeys made and the recovery key
// text) must be wiped, and what a job that outlives its sheet may do. Plain
// code with no React, so every exit is tested in node (the hook beside it only
// calls these from effects).
//
// Each makeKeys call gives its own draft handle, and a wipe only ever touches
// its own handle: the sheet closing, unmounting and Back to the password wipe
// the current draft, and a draft that arrives after its sheet is gone wipes
// itself. A late draft can never wipe, or replace, the draft of the sheet that
// was opened after it.

/** The keys one makeKeys call made: the recovery key text to show, and how to wipe exactly those keys. */
export type KeyDraft = {
	keyText: string;
	wipe: () => void;
};

export type LifecyclePorts = {
	/** Back to the first step with nothing typed. */
	reset: () => void;
};

/**
 * What became of a job. A late one finished after its sheet closed or
 * unmounted: it is dropped. A late success hands back its value so the caller
 * can wipe what it made.
 */
export type JobOutcome<T> =
	| { status: "done"; value: T }
	| { status: "failed"; error: unknown }
	| { status: "late"; value?: T }
	| { status: "ignored" };

/** The step Back from which drops the keys: they were made for the password that is being retyped. */
const BACK_DROPS_KEYS_FROM = "methods";

/** Anything with secrets to wipe: the enable draft, and the recovery and Make new key drafts that share this lifecycle. */
type Wipeable = { wipe: () => void };

export function createEnableLifecycle<D extends Wipeable = KeyDraft>(
	ports: LifecyclePorts,
) {
	// Counts closes and unmounts, so a job knows whether its sheet is the same one.
	let epoch = 0;
	let running = false;
	let current: D | null = null;

	const wipeCurrent = () => {
		const draft = current;
		current = null;
		draft?.wipe();
	};

	/** Runs one job at a time; one that ends after its sheet is gone is dropped. */
	async function run<T>(job: () => Promise<T>): Promise<JobOutcome<T>> {
		if (running) return { status: "ignored" };
		running = true;
		const started = epoch;
		let outcome: JobOutcome<T>;
		try {
			outcome = { status: "done", value: await job() };
		} catch (error) {
			outcome = { status: "failed", error };
		} finally {
			// A late job must not clear the flag of the job that replaced it.
			if (epoch === started) running = false;
		}
		if (epoch === started) return outcome;
		return outcome.status === "done"
			? { status: "late", value: outcome.value }
			: { status: "late" };
	}

	return {
		/** A job is working: nothing else starts and the sheet does not close. */
		get running() {
			return running;
		},

		/** The keys the sheet holds now; `save` is given this one. */
		get draft(): D | null {
			return current;
		},

		/** The sheet's `open` became false (Cancel, Escape, the parent, Done). */
		closed() {
			epoch += 1;
			// A job still working belongs to the sheet that closed: it no longer blocks the next.
			running = false;
			ports.reset();
			wipeCurrent();
		},

		/** The sheet is gone. */
		unmounted() {
			epoch += 1;
			running = false;
			wipeCurrent();
		},

		/** Back was pressed on `step`. */
		back(step: string) {
			if (step === BACK_DROPS_KEYS_FROM) wipeCurrent();
		},

		/** The current draft is stale (a step that made it is being redone): wipe it. */
		drop() {
			wipeCurrent();
		},

		/** The person asked to close from inside the sheet: not while a job works. */
		canClose() {
			return !running;
		},

		run,

		/**
		 * Makes a draft. In time, it becomes the current one. Late, it wipes
		 * itself (and only itself) and is dropped.
		 */
		async makeDraft(job: () => Promise<D>): Promise<JobOutcome<D>> {
			const outcome = await run(job);
			if (outcome.status === "done") {
				const before = current;
				current = outcome.value;
				before?.wipe();
			} else if (outcome.status === "late") outcome.value?.wipe();
			return outcome;
		},
	};
}

export type EnableLifecycle<D extends Wipeable = KeyDraft> = ReturnType<
	typeof createEnableLifecycle<D>
>;
