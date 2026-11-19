import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The contract's two-factor code length, read from its source. The contract's
 * runtime is ES modules that jest does not load, so a test that needs the
 * number mocks the package with this value instead of retyping it.
 */
export const contractCodeLength: number = (() => {
	const source = readFileSync(
		join(__dirname, "../../../packages/api-contract/src/account/security.ts"),
		"utf8",
	);
	const found = /export const TWO_FACTOR_CODE_LENGTH = (\d+);/.exec(source);
	if (!found?.[1]) throw new Error("TWO_FACTOR_CODE_LENGTH not found");
	return Number(found[1]);
})();
