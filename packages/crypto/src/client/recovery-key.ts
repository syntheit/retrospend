// What the web and the phone share around a recovery key: making one for an
// account key (makeRecoveryKey, used by enable and Make new key), which two
// groups the person retypes to prove they saved it, whether what they typed
// matches, and the text of the file they can save. keys.ts owns the format
// (encode, parse, subkeys); nothing here stores or sends the key.
import { dayKey } from "@retrospend/domain/time-zone";
import { toBase64Url } from "../base64url";
import { bad } from "../errors";
import {
	encodeRecoveryKey,
	generateRecoveryKey,
	normalizeRecoveryText,
	parseRecoveryKey,
	RECOVERY_GROUPS,
	recoveryGroups,
	recoverySubkeys,
	wrapKey,
} from "../keys";
import type { Primitives } from "../primitives";
import { checkOpens, KeyFlowError, type secretBin } from "./flow";

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

/** What the confirm step reads: the key as written down, the two groups asked for and what was typed. Enable and Make new key both fill it, on every platform. */
export type KeyConfirmState = {
	/** The recovery key as written down; empty until the keys are made. */
	keyText: string;
	/** The two groups asked for at the confirm step, counted from 0. */
	groups: ConfirmGroups | null;
	typed: readonly [string, string];
};

/** Both typed groups are the groups asked for. Nothing asked yet is never a match. */
export function groupsConfirmed(state: KeyConfirmState): boolean {
	if (!state.groups || state.keyText === "") return false;
	const all = recoveryKeyGroups(state.keyText);
	return state.groups.every((at, i) =>
		groupMatches(state.typed[i] ?? "", all[at] ?? ""),
	);
}

/**
 * A typed group that is as long as the group and still not it. Shorter text is
 * still being typed, so it is not called wrong yet.
 */
export function groupMismatch(state: KeyConfirmState, index: 0 | 1): boolean {
	const at = state.groups?.[index];
	if (at === undefined || state.keyText === "") return false;
	const group = recoveryKeyGroups(state.keyText)[at] ?? "";
	const typed = state.typed[index];
	return (
		typed.replace(/[\s-]/g, "").length >= group.length &&
		!groupMatches(typed, group)
	);
}

/**
 * The name of the saved recovery key file. It says what the file is and names
 * no one, so the web and the phone save the same file name.
 */
export const RECOVERY_KEY_FILE_NAME = "retrospend-recovery-key.txt";

/**
 * The nine groups of a key's text, in order, read through the key's own
 * format (so a typed key with spaces or look-alike letters gives its canonical
 * groups, and a key with a typo throws `invalid_input`). The decoded key bytes
 * are wiped before this returns.
 */
export function recoveryKeyGroups(keyText: string): string[] {
	const bytes = parseRecoveryKey(keyText);
	try {
		return recoveryGroups(bytes);
	} finally {
		bytes.fill(0);
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
 * written again, so a key with a typo never lands in a file. `account` is the
 * account's email (its unique sign-in name) and `made` the instant the keys
 * were made, written as the person's calendar day (`dayKey`, "yyyy-MM-dd")
 * so every platform writes the same date format.
 */
export function recoveryKeyFileText(
	labels: RecoveryFileLabels,
	file: { keyText: string; account: string; made: Date },
): string {
	const key = encodeRecoveryKey(parseRecoveryKey(file.keyText));
	return [
		labels.title,
		"",
		`${labels.account}: ${file.account}`,
		`${labels.made}: ${dayKey(file.made)}`,
		"",
		`${labels.key}:`,
		key,
		"",
		labels.keepSafe,
		"",
	].join("\n");
}

/** What a new recovery key gives: the wrap to store, the proof to send, the text to write down. */
export type MadeRecoveryKey = {
	/** The account key wrapped under the key's wrap key, base64url. */
	wrapped: string;
	/** The recovery auth key, base64url. */
	recoveryAuthKey: string;
	/** Nine groups of six. */
	recoveryKeyText: string;
};

/**
 * The one way a recovery key is made for an account key (enable and Make new
 * key): a fresh key, its subkeys, the ak-recovery wrap and the text, then the
 * check before anything is returned. The key is read back from the text the
 * person will write down, that key must make the proof returned, and the wrap
 * must open under its wrap key to exactly `accountKey`; anything else is
 * `malformed`. Every key made is kept in `bin` for the caller to wipe, and
 * `accountKey` is only read.
 */
export function makeRecoveryKey(
	p: Primitives,
	bin: ReturnType<typeof secretBin>,
	input: { userId: string; accountKey: Uint8Array },
): MadeRecoveryKey {
	const recoveryKey = bin.keep(generateRecoveryKey(p));
	const recovery = recoverySubkeys(p, recoveryKey);
	bin.keep(recovery.wrapKey);
	bin.keep(recovery.authKey);
	const made: MadeRecoveryKey = {
		wrapped: toBase64Url(
			wrapKey(
				p,
				recovery.wrapKey,
				"ak-recovery",
				input.userId,
				input.accountKey,
			),
		),
		recoveryAuthKey: toBase64Url(recovery.authKey),
		recoveryKeyText: encodeRecoveryKey(recoveryKey),
	};
	const written = recoverySubkeys(
		p,
		bin.keep(parseRecoveryKey(made.recoveryKeyText)),
	);
	bin.keep(written.wrapKey);
	bin.keep(written.authKey);
	if (made.recoveryAuthKey !== toBase64Url(written.authKey))
		throw new KeyFlowError("malformed");
	checkOpens(p, bin, {
		wrappingKey: written.wrapKey,
		role: "ak-recovery",
		id: input.userId,
		sent: made.wrapped,
		expected: input.accountKey,
	});
	return made;
}
