import type { ErrorKind, ErrorLog } from "./errorLog";

// The global JS error handler and the unhandled promise rejection hook. Both
// record into the local ring and then let the app carry on exactly as before
// (the previous handler still runs). Nothing is sent from here.

interface ErrorUtilsLike {
	getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
	setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

interface HermesLike {
	enablePromiseRejectionTracker?: (options: {
		allRejections: boolean;
		onUnhandled: (id: number, error: unknown) => void;
		onHandled?: (id: number) => void;
	}) => void;
}

export interface ErrorScope {
	ErrorUtils?: ErrorUtilsLike;
	HermesInternal?: HermesLike;
}

/** A fatal error gets this long to reach disk before the app is allowed to die. */
const FATAL_GRACE_MS = 400;

let installed = false;

export function installErrorHandlers(
	log: ErrorLog,
	scope: ErrorScope = globalThis as ErrorScope,
	dev = typeof __DEV__ !== "undefined" && __DEV__,
): void {
	if (installed) return;
	installed = true;
	const record = (kind: ErrorKind, error: unknown) =>
		log.record(kind, error).catch(() => undefined);

	const utils = scope.ErrorUtils;
	if (utils) {
		const previous = utils.getGlobalHandler();
		utils.setGlobalHandler((error, isFatal) => {
			const done = record("crash", error);
			if (!isFatal) {
				previous(error, isFatal);
				return;
			}
			// The write must land before a fatal error ends the process.
			void Promise.race([
				done,
				new Promise((resolve) => setTimeout(resolve, FATAL_GRACE_MS)),
			]).then(() => previous(error, isFatal));
		});
	}

	scope.HermesInternal?.enablePromiseRejectionTracker?.({
		allRejections: true,
		onUnhandled: (_id, error) => {
			void record("rejection", error);
			if (dev) console.warn("Unhandled promise rejection", error);
		},
	});
}

/** For tests: forget that handlers were installed. */
export function resetErrorHandlersForTest(): void {
	installed = false;
}
