import { randomBytes } from "node:crypto";
import { passwordMeetsRules } from "@retrospend/api-contract";

/** Enough that a draw which keeps missing a case or a digit is a broken source, not bad luck. */
const MAX_DRAWS = 50;

/**
 * A random password (16 characters of base64url) that meets the new password
 * rules, for an admin reset. A plain draw misses a digit or a case about one
 * time in eight. Sign-in does not check complexity, so such a password would
 * still work, but a person who then tries to keep it through a change (or any
 * later rule check) would be refused, so the reset hands out one that passes.
 */
export function generatePassword(
	random: (size: number) => Buffer = randomBytes,
): string {
	for (let draw = 0; draw < MAX_DRAWS; draw++) {
		const candidate = random(12).toString("base64url");
		if (passwordMeetsRules(candidate)) return candidate;
	}
	throw new Error("No generated password met the password rules");
}
