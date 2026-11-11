/**
 * Whether this process seals user text on write (E2EE D11 PR 4,
 * docs/roadmap/e2ee-d11-pr4.md section 1). False until the seal engine and
 * its gates exist (PR 4.2 and 4.3): until then nothing seals, and the callers
 * that act on it (the first-write key mint, the sign-in ensure) do nothing.
 * Tests flip it here instead of mocking the module.
 */
let current: () => boolean = () => false;

export const sealing = (): boolean => current();

/** Test hook: what `sealing()` answers; pass nothing to go back to false. */
export function setSealingForTests(answer?: () => boolean): void {
	current = answer ?? (() => false);
}
