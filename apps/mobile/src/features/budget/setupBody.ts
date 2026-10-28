import type { RetrospendClient } from "@retrospend/api-client";
import { toMinor } from "@retrospend/domain/money-minor";
import { wireAmount } from "./amount";
import { isIsoDay } from "./DayField";

// The set-up wizard's request: the server's proposal for a style, with the
// envelopes you keep and the amounts you changed. The body is built from the
// proposal as it came, so everything the phone does not ask (rules, group
// targets, sweeps) is sent back unchanged.

type Client = RetrospendClient["budget"];
export type SetupInput = Parameters<Client["setup"]>[0];
export type SetupPreset = Awaited<ReturnType<Client["setupPreset"]>>;
export type SetupStyle = SetupInput["style"];
export type PayFrequency = NonNullable<SetupInput["pay"]>["frequency"];
type PresetEnvelope = SetupPreset["envelopes"][number];
type Target = NonNullable<PresetEnvelope["target"]>;

/** The preset envelope that holds a Pay off debt plan's extra each month. */
export const EXTRA_DEBT_KEY = "extra-debt";

/** The first question's answers: a style, or only tracking (nothing is written). */
export type SetupChoice = SetupStyle | "TRACK";
export const ANSWERS: SetupChoice[] = [
	"TRACK",
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
];
export const METHODS: SetupChoice[] = [
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
	"DEBT_PAYOFF",
];

export type SetupStep = "style" | "pay" | "money" | "envelopes";

/** The questions each answer asks: Track stops at the first, Limits asks for no money now or pay. */
export function stepsOf(choice: SetupChoice): SetupStep[] {
	if (choice === "TRACK") return ["style"];
	if (choice === "LIMITS") return ["style", "envelopes"];
	return ["style", "pay", "money", "envelopes"];
}

/** How you get paid: nothing is assumed until it is answered. */
export interface PayAnswer {
	frequency: PayFrequency | null;
	next: string;
}

/** Whether the pay answer can go on: no answer or "It varies" need no date, a dated cycle needs today or later. */
export function payAnswered(pay: PayAnswer, today: string): boolean {
	if (!pay.frequency || pay.frequency === "VARIES") return true;
	return isIsoDay(pay.next) && pay.next >= today;
}

/** Targets that carry an amount the person may change. */
export function hasAmount(
	t: Target | null,
): t is Extract<Target, { kind: "MONTHLY" | "BILL" | "SAVINGS" }> {
	return (
		t !== null &&
		(t.kind === "MONTHLY" || t.kind === "BILL" || t.kind === "SAVINGS")
	);
}

/** The amount a preset envelope starts with, in minor units; null when it has none. */
export function presetMinor(
	e: PresetEnvelope,
	currency: string,
): number | null {
	const t = e.target;
	if (!hasAmount(t) || !t.amount) return null;
	return toMinor(t.amount, currency);
}

export interface SetupDraft {
	style: SetupStyle;
	/** Envelopes switched off (a default one can not be). */
	off: ReadonlySet<string>;
	/** Amounts typed per envelope key, in minor units. */
	amounts: Readonly<Record<string, number>>;
	haveNowMinor: number | null;
	pay: PayAnswer;
	strategy: "AVALANCHE" | "SNOWBALL";
}

/** Translates a preset's message key (or uses the name it came with). */
export type NameOf = (
	nameKey: string | null,
	fallback: string | null,
) => string;

/** The write exactly as the wizard shows it; null until it has an envelope to create. */
export function setupBody(
	preset: SetupPreset,
	draft: SetupDraft,
	nameOf: NameOf,
): SetupInput | null {
	const { currency } = preset;
	const keep = preset.envelopes.filter(
		(e) => e.isDefault || !draft.off.has(e.key),
	);
	const envelopes: SetupInput["envelopes"] = keep.map((e) => {
		const edited = draft.amounts[e.key];
		const t = e.target;
		const target =
			t && hasAmount(t) && edited !== undefined
				? { ...t, amount: wireAmount(edited, currency) }
				: (t ?? undefined);
		return {
			key: e.key,
			name: nameOf(e.nameKey, e.name),
			groupKey: e.groupKey,
			kind: e.kind,
			isDefault: e.isDefault,
			categoryIds: e.categoryIds,
			...(target ? { target } : {}),
			...(e.sweepToKey && keep.some((k) => k.key === e.sweepToKey)
				? { sweepToKey: e.sweepToKey }
				: {}),
		};
	});
	if (envelopes.length === 0) return null;
	const used = new Set(envelopes.map((e) => e.groupKey));
	const out: SetupInput = {
		style: draft.style,
		groups: preset.groups
			.filter((g) => used.has(g.key))
			.map((g) => ({
				key: g.key,
				name: nameOf(g.nameKey, null),
				role: g.role,
				...(g.target ? { target: g.target } : {}),
			})),
		envelopes,
	};
	const rules = (preset.rules ?? []).filter((r) =>
		envelopes.some((e) => e.key === r.envelopeKey),
	);
	if (rules.length > 0) {
		out.rules = rules.map(({ nameKey, ...rest }) => ({
			...rest,
			name: nameOf(nameKey, null),
		}));
	}
	if (draft.style !== "LIMITS" && draft.haveNowMinor !== null) {
		out.startingMoney = wireAmount(draft.haveNowMinor, currency);
	}
	const { frequency, next } = draft.pay;
	if (frequency === "VARIES") out.pay = { frequency, nextPay: null };
	else if (frequency && isIsoDay(next)) out.pay = { frequency, nextPay: next };
	const extra = keep.find((e) => e.key === EXTRA_DEBT_KEY);
	if (draft.style === "DEBT_PAYOFF" && extra) {
		const minor =
			draft.amounts[EXTRA_DEBT_KEY] ?? presetMinor(extra, currency) ?? 0;
		out.payoff = {
			strategy: draft.strategy,
			extraMonthly: wireAmount(minor, currency),
			envelopeKey: EXTRA_DEBT_KEY,
		};
	}
	return out;
}

/** The preset's message keys live in the web's envelope namespace; the phone keeps its own copy under mobile.budget.setup.names. */
export function nameKeyPath(nameKey: string): string {
	return nameKey.replace(/^envelope\./, "");
}
