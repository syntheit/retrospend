import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// Income rules: what happens to money that arrives. A rule moves no money
// when it is made; "apply to this month" is the money write.

type Client = RetrospendClient["budget"];
export type CreateRuleInput = Parameters<Client["createRule"]>[0];
export type ApplyRuleInput = Parameters<Client["applyRule"]>[0];
export type Rule = Awaited<ReturnType<Client["rules"]>>[number];
export type RuleKind = "PERCENT" | "AMOUNT" | "REMAINDER";

/**
 * "12.5" or "12,5" as hundredths of a percent (1250); null unless it is 0.01
 * to 100 with at most two decimals. Read as text so no float is involved.
 */
export function percentBasisPoints(text: string): number | null {
	const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
	if (!match) return null;
	const whole = Number(match[1]);
	const fraction = Number((match[2] ?? "").padEnd(2, "0"));
	const bp = whole * 100 + fraction;
	return bp >= 1 && bp <= 10_000 ? bp : null;
}

export function createRuleBody(input: {
	id: string;
	name: string;
	kind: RuleKind;
	percentText: string;
	minor: number | null;
	currency: string;
	envelopeId: string | null;
}): CreateRuleInput | null {
	const name = input.name.trim();
	if (name === "" || !input.envelopeId) return null;
	let action: CreateRuleInput["action"] | null = null;
	if (input.kind === "REMAINDER") action = { kind: "REMAINDER" };
	else if (input.kind === "PERCENT") {
		const bp = percentBasisPoints(input.percentText);
		if (bp !== null) action = { kind: "PERCENT", basisPoints: bp };
	} else if (input.minor !== null && input.minor > 0) {
		action = {
			kind: "AMOUNT",
			amount: wireAmount(input.minor, input.currency),
		};
	}
	if (!action) return null;
	return {
		id: input.id,
		name,
		match: { kind: "ANY" },
		action,
		envelopeId: input.envelopeId,
	};
}

export function applyRuleBody(input: {
	batchId: string;
	ruleId: string;
}): ApplyRuleInput {
	return { batchId: input.batchId, ruleId: input.ruleId };
}

/** The rule ids after moving the one at `index` by one place; null at an end. */
export function movedIds(
	ids: readonly string[],
	index: number,
	by: -1 | 1,
): string[] | null {
	const to = index + by;
	if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) {
		return null;
	}
	const next = [...ids];
	const [id] = next.splice(index, 1);
	if (id === undefined) return null;
	next.splice(to, 0, id);
	return next;
}
