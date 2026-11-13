/**
 * Whether this process seals user text on write (E2EE D11 PR 4,
 * docs/roadmap/e2ee-d11-pr4.md sections 1 and 3): DATA_KEYS_WRITE, and in
 * production only once sealing is released (release.ts). db.ts wires the
 * setting, so this file reads no environment and a unit test seals nothing.
 * The start-up check (field-encryption-start.ts) refuses a server with the
 * flag on that lacks what sealing needs. In production nothing seals until
 * that check has passed in this process (it sets the epoch and raises the
 * floor first), so a script run with the flag set, which skips the check,
 * never seals. Tests flip it here instead of mocking.
 */
import { SEALING_RELEASED } from "./release";

// On globalThis, not in module state: Next bundles instrumentation, route
// handlers and pages separately, each with its own copy of this module, and
// the start check marks only the instrumentation copy (see settings.ts).
const startPassed = Symbol.for("retrospend.sealingStartPassed");

const sealingStartPassed = (): boolean =>
	(globalThis as Record<symbol, unknown>)[startPassed] === true;

/**
 * What the setting asks for. Strictly `true`: with env validation skipped
 * (the image build) the flag is the raw string, truthy whatever it says.
 */
export const sealingWanted = (
	flag: unknown,
	nodeEnv: unknown,
	released = SEALING_RELEASED,
	started = sealingStartPassed(),
): boolean =>
	flag === true && (nodeEnv !== "production" || (released && started));

/** field-encryption-start.ts, once the epoch is set: this process may seal. */
export function markSealingStartPassed(): void {
	(globalThis as Record<symbol, unknown>)[startPassed] = true;
}

let setting: () => boolean = () => false;
let current: () => boolean = () => setting();

export const sealing = (): boolean => current();

/** db.ts: where the setting comes from. */
export function wireSealingSetting(read: () => boolean): void {
	setting = read;
}

/** Test hook: what `sealing()` answers; pass nothing to go back to the setting. */
export function setSealingForTests(answer?: () => boolean): void {
	current = answer ?? (() => setting());
}
