import type { Money } from "@retrospend/domain/money-minor";
import type { ProjectPage } from "./source";

export interface SkippedLine {
	person: string;
	direction: "outgoing" | "incoming";
	amount: Money;
	reason: "matches_claim" | "overpay" | "nothing_owed";
}

/**
 * The payments the dry run says Settle all would record, and the lines it
 * leaves to the person (the `detail` of the preview, kind
 * `project.settleAll`; the server validated it). Nothing before the preview
 * arrives, and nothing for a detail of another kind.
 */
export function settleAllDetailOf(preview: { detail?: unknown } | null): {
	willRecord: WillRecord[];
	skipped: SkippedLine[];
} {
	const detail = preview?.detail as
		| { kind?: string; willRecord?: WillRecord[]; skipped?: SkippedLine[] }
		| undefined;
	if (detail?.kind !== "project.settleAll") {
		return { willRecord: [], skipped: [] };
	}
	return {
		willRecord: detail.willRecord ?? [],
		skipped: detail.skipped ?? [],
	};
}

/** True for the problem the server answers when the balances moved since the plan. */
export function isConflict(error: unknown): boolean {
	const shape = error as { code?: string; status?: number } | null;
	return shape?.code === "conflict" || shape?.status === 409;
}

/** `<type>:<id>`, the key the plan names a person by. */
export function memberKey(member: {
	participantType: string;
	participantId: string;
}): string {
	return `${member.participantType}:${member.participantId}`;
}

/** A person's name for a plan line; the key itself only when they are not a member now. */
export function nameOfKey(members: ProjectPage["members"], key: string) {
	return members.find((m) => memberKey(m) === key)?.name ?? key;
}

export interface WillRecord {
	person: string;
	direction: "outgoing" | "incoming";
	amount: Money;
	status: "PROPOSED" | "FINALIZED";
}

/**
 * A line of the preview in words: who, which way, how much, and whether the
 * other person has to confirm it. The numbers are the server's.
 */
export function describeLine(
	line: WillRecord,
	nameOf: (key: string) => string,
): {
	key: string;
	name: string;
	direction: WillRecord["direction"];
	waiting: boolean;
} {
	return {
		key: `${line.person}:${line.amount.currency}`,
		name: nameOf(line.person),
		direction: line.direction,
		// An outgoing payment to someone on Retrospend waits for them to confirm.
		waiting: line.status === "PROPOSED",
	};
}
