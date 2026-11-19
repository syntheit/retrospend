// When the enable sheet's draft (the keys the caller made, the recovery key
// text) must be wiped, and what a job that outlives its sheet may do. Plain
// code with no React, so every exit is tested in node (the hook beside it only
// calls these from effects). Every exit ends in `discard`: the sheet closing,
// the sheet unmounting, Back to the password, and a job (makeKeys, save) that
// finishes after the sheet is already gone, whether it succeeded or failed.

export type LifecyclePorts = {
	/** Wipe the caller's draft. Safe to call again. */
	discard: () => void;
	/** Back to the first step with nothing typed. */
	reset: () => void;
};

/** What became of a job. A late one finished after its sheet closed or unmounted: it is dropped. */
export type JobOutcome<T> =
	| { status: "done"; value: T }
	| { status: "failed"; error: unknown }
	| { status: "late" }
	| { status: "ignored" };

/** The step Back from which drops the keys: they were made for the password that is being retyped. */
const BACK_DROPS_KEYS_FROM = "methods";

export function createEnableLifecycle(ports: LifecyclePorts) {
	// Counts closes and unmounts, so a job knows whether its sheet is the same one.
	let epoch = 0;
	let running = false;

	return {
		/** A job is working: nothing else starts and the sheet does not close. */
		get running() {
			return running;
		},

		/** The sheet's `open` became false (Cancel, Escape, the parent, Done). */
		closed() {
			epoch += 1;
			// A job still working belongs to the sheet that closed: it no longer blocks the next.
			running = false;
			ports.reset();
			ports.discard();
		},

		/** The sheet is gone. */
		unmounted() {
			epoch += 1;
			running = false;
			ports.discard();
		},

		/** Back was pressed on `step`. */
		back(step: string) {
			if (step === BACK_DROPS_KEYS_FROM) ports.discard();
		},

		/** The person asked to close from inside the sheet: not while a job works. */
		canClose() {
			return !running;
		},

		/**
		 * Runs one job at a time. A job that finishes after its sheet closed or
		 * unmounted wipes the draft and is dropped, success or failure alike: the
		 * state it would land in belongs to a sheet that is no longer there.
		 */
		async run<T>(job: () => Promise<T>): Promise<JobOutcome<T>> {
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
			ports.discard();
			return { status: "late" };
		},
	};
}

export type EnableLifecycle = ReturnType<typeof createEnableLifecycle>;
