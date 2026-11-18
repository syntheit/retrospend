// What the web and the phone share around showing a recovery key: which two
// groups the person retypes to prove they saved it, whether what they typed
// matches, and the text of the file they can save. The key itself is made and
// written by keys.ts; nothing here stores or sends it.
import { bad } from "../errors";
import {
	encodeRecoveryKey,
	normalizeRecoveryText,
	parseRecoveryKey,
	RECOVERY_GROUPS,
} from "../keys";
import type { Primitives } from "../primitives";

/** Two group numbers, counted from 0, in ascending order. */
export type ConfirmGroups = readonly [number, number];

/**
 * An integer below `below`, from the primitives' random bytes. Bytes at or
 * above the largest multiple of `below` are thrown away, so no number is
 * likelier than another. This is the `random` a platform passes to
 * `pickConfirmGroups`; tests pass their own.
 */
export function randomBelow(
	p: Pick<Primitives, "randomBytes">,
	below: number,
): number {
	if (!Number.isInteger(below) || below < 1 || below > 256) bad();
	const limit = 256 - (256 % below);
	for (;;) {
		const byte = p.randomBytes(1)[0] as number;
		if (byte < limit) return byte % below;
	}
}

/**
 * Which two of the nine groups to ask for. Every pair of different groups is a
 * candidate and nothing else is, so the two are never the same group. With
 * `previous` (the pair the person just saw before pressing Back) that pair is
 * left out, so Back always shows new groups. `random(n)` is an integer from
 * 0 to n - 1; one outside that range is refused.
 */
export function pickConfirmGroups(
	random: (below: number) => number,
	previous?: ConfirmGroups,
): ConfirmGroups {
	const pairs: ConfirmGroups[] = [];
	for (let a = 0; a < RECOVERY_GROUPS; a++) {
		for (let b = a + 1; b < RECOVERY_GROUPS; b++) {
			if (previous && previous[0] === a && previous[1] === b) continue;
			pairs.push([a, b]);
		}
	}
	const at = random(pairs.length);
	const pair = Number.isInteger(at) ? pairs[at] : undefined;
	return pair ?? bad();
}

/**
 * Whether what was typed is the group. It is read the way the whole key is
 * (case, spaces and hyphens do not matter, O is 0, I and L are 1) and must
 * be the whole group. Anything unreadable does not match.
 */
export function groupMatches(typed: string, group: string): boolean {
	try {
		return normalizeRecoveryText(typed) === normalizeRecoveryText(group);
	} catch {
		return false;
	}
}

/** The words of the saved file: the platform's translations, passed in so every platform writes the same file. */
export type RecoveryFileLabels = {
	title: string;
	account: string;
	made: string;
	key: string;
	keepSafe: string;
};

/**
 * The text of the recovery key file, line by line. The key is parsed and
 * written again, so a key with a typo never lands in a file. `account` is a
 * display name for the account and `made` a date the platform formatted.
 */
export function recoveryKeyFileText(
	labels: RecoveryFileLabels,
	file: { keyText: string; account: string; made: string },
): string {
	const key = encodeRecoveryKey(parseRecoveryKey(file.keyText));
	return [
		labels.title,
		"",
		`${labels.account}: ${file.account}`,
		`${labels.made}: ${file.made}`,
		"",
		`${labels.key}:`,
		key,
		"",
		labels.keepSafe,
		"",
	].join("\n");
}
