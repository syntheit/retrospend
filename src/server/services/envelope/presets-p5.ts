/**
 * Setup presets for the P5 styles (SPEC §4.2): Save first and 50/30/20.
 * Proposals only, like every preset: the client shows them, the person
 * edits them, and setup writes what comes back.
 *
 * - Save first: the Savings goal first, Bills from recurring expenses, one
 *   Spending envelope for the rest; rules "20% of money in to Savings" and
 *   "The rest to Spending" (the percentage is asked). Leftovers carry; the
 *   sweep of Spending into Savings is asked, so it is not preset.
 * - 50/30/20: groups Needs 50%, Wants 30%, Savings 20% of money in, one
 *   envelope per group. Fixed categories start in Needs, the rest in Wants
 *   (the suggested mapping the person drags to fix).
 */
import type { SetupPresetOutput } from "~/lib/schemas/envelope";
import type { PresetCategory, PresetTemplate } from "./presets";
import { billEnvelopes, savingsGoal } from "./presets";

type Preset = Omit<SetupPresetOutput, "style" | "currency" | "missingRates">;
type PresetEnvelope = SetupPresetOutput["envelopes"][number];

/** Save first's starting percentage to savings, in basis points (20%). */
export const SAVE_FIRST_BP = 2_000;

export function saveFirst(templates: readonly PresetTemplate[]): Preset {
	const spending: PresetEnvelope = {
		key: "spending",
		nameKey: "envelope.envelopes.spending",
		name: null,
		groupKey: "spending",
		kind: "MONTHLY",
		isDefault: true,
		categoryIds: [],
		templateId: null,
		target: null,
	};
	return {
		groups: [
			{ key: "savings", nameKey: "envelope.groups.savings", role: "SAVINGS" },
			{ key: "bills", nameKey: "envelope.groups.bills", role: "BILLS" },
			{
				key: "spending",
				nameKey: "envelope.groups.spending",
				role: "SPENDING",
			},
		],
		envelopes: [savingsGoal, ...billEnvelopes(templates), spending],
		rules: [
			{
				nameKey: "envelope.rules.saveFirst",
				match: { kind: "ANY" },
				action: { kind: "PERCENT", basisPoints: SAVE_FIRST_BP },
				envelopeKey: "savings",
			},
			{
				nameKey: "envelope.rules.rest",
				match: { kind: "ANY" },
				action: { kind: "REMAINDER" },
				envelopeKey: "spending",
			},
		],
	};
}

export function fiftyThirtyTwenty(
	categories: readonly PresetCategory[],
): Preset {
	const env = (
		key: "needs" | "wants",
		categoryIds: string[],
		isDefault: boolean,
	): PresetEnvelope => ({
		key,
		nameKey: `envelope.envelopes.${key}`,
		name: null,
		groupKey: key,
		kind: "MONTHLY",
		isDefault,
		categoryIds,
		templateId: null,
		target: null,
	});
	const pct = (basisPoints: number) => ({
		kind: "PERCENT_OF_INCOME" as const,
		basisPoints,
	});
	return {
		groups: [
			{
				key: "needs",
				nameKey: "envelope.groups.needs",
				role: "BILLS",
				target: pct(5_000),
			},
			{
				key: "wants",
				nameKey: "envelope.groups.wants",
				role: "SPENDING",
				target: pct(3_000),
			},
			{
				key: "savings",
				nameKey: "envelope.groups.savings",
				role: "SAVINGS",
				target: pct(2_000),
			},
		],
		envelopes: [
			env(
				"needs",
				categories.filter((c) => c.isFixed).map((c) => c.id),
				false,
			),
			// Wants covers every other category, so it is the default envelope.
			env(
				"wants",
				categories.filter((c) => !c.isFixed).map((c) => c.id),
				true,
			),
			savingsGoal,
		],
		rules: [],
	};
}
