/**
 * Style presets for setup (SPEC §4.2, §4.3 step 4; owner r5 Q4): the groups
 * and starting envelopes each style proposes. A preset is a proposal only:
 * the client shows it, the person edits it, and `setup` writes what comes
 * back (B8: styles are presets, not modes). Names are message keys
 * (namespace `envelope`) so the client sends them back translated; an
 * envelope that follows a recurring expense or a category keeps that name.
 *
 * P2 covers Flex (default), Every dollar and Weekly.
 */
import type { SetupPresetOutput } from "~/lib/schemas/envelope";

export type SetupStyle = SetupPresetOutput["style"];

export interface PresetTemplate {
	id: string;
	name: string;
	categoryId: string | null;
	frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
}

export interface PresetCategory {
	id: string;
	name: string;
	isFixed: boolean;
}

/** Bills can follow templates that repeat in whole months (02 §3.5). */
export const MONTHLY_FREQUENCIES = new Set(["MONTHLY", "QUARTERLY", "YEARLY"]);

const GROUPS = {
	FLEX: [
		{ key: "bills", nameKey: "envelope.groups.bills", role: "BILLS" },
		{ key: "spending", nameKey: "envelope.groups.spending", role: "SPENDING" },
		{ key: "savings", nameKey: "envelope.groups.savings", role: "SAVINGS" },
	],
	EVERY_DOLLAR: [
		{ key: "bills", nameKey: "envelope.groups.bills", role: "BILLS" },
		{ key: "everyday", nameKey: "envelope.groups.everyday", role: "SPENDING" },
		{ key: "savings", nameKey: "envelope.groups.savings", role: "SAVINGS" },
	],
} as const;

type PresetEnvelope = SetupPresetOutput["envelopes"][number];

function billEnvelopes(templates: readonly PresetTemplate[]): PresetEnvelope[] {
	const linked = new Set<string>();
	return templates
		.filter((t) => MONTHLY_FREQUENCIES.has(t.frequency))
		.map((t) => {
			// A category links to one envelope only; a second bill in it keeps no link.
			const cat =
				t.categoryId && !linked.has(t.categoryId) ? t.categoryId : null;
			if (cat) linked.add(cat);
			return {
				key: `bill-${t.id}`,
				nameKey: null,
				name: t.name,
				groupKey: "bills",
				kind: "BILL" as const,
				isDefault: false,
				categoryIds: cat ? [cat] : [],
				templateId: t.id,
				target: { kind: "BILL_TEMPLATE" as const, templateId: t.id },
			};
		});
}

const savingsGoal: PresetEnvelope = {
	key: "savings",
	nameKey: "envelope.envelopes.savings",
	name: null,
	groupKey: "savings",
	kind: "SAVINGS",
	isDefault: false,
	categoryIds: [],
	templateId: null,
	target: null,
};

/**
 * Flex and Weekly: Bills from recurring expenses, one Spending envelope that
 * covers every other category (the default envelope), one savings goal.
 * Weekly puts Spending on a per-week target the person sizes in setup.
 */
function flex(
	style: SetupStyle,
	templates: readonly PresetTemplate[],
): PresetEnvelope[] {
	return [
		...billEnvelopes(templates),
		{
			key: "spending",
			nameKey: "envelope.envelopes.spending",
			name: null,
			groupKey: "spending",
			kind: "MONTHLY",
			isDefault: true,
			categoryIds: [],
			templateId: null,
			target:
				style === "WEEKLY"
					? { kind: "MONTHLY", amountMinor: 0, mode: "REFILL", cadence: "WEEK" }
					: null,
		},
		savingsGoal,
	];
}

/** Every dollar: one envelope per category (fixed ones under Bills), Everything else, one goal. */
function everyDollar(
	templates: readonly PresetTemplate[],
	categories: readonly PresetCategory[],
): PresetEnvelope[] {
	const bills = billEnvelopes(templates);
	const taken = new Set(bills.flatMap((b) => b.categoryIds));
	const perCategory = categories
		.filter((c) => !taken.has(c.id))
		.map(
			(c): PresetEnvelope => ({
				key: `cat-${c.id}`,
				nameKey: null,
				name: c.name,
				groupKey: c.isFixed ? "bills" : "everyday",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [c.id],
				templateId: null,
				target: null,
			}),
		);
	return [
		...bills,
		...perCategory,
		{
			key: "else",
			nameKey: "envelope.envelopes.everythingElse",
			name: null,
			groupKey: "everyday",
			kind: "MONTHLY",
			isDefault: true,
			categoryIds: [],
			templateId: null,
			target: null,
		},
		savingsGoal,
	];
}

export function stylePreset(p: {
	style: SetupStyle;
	currency: string;
	templates: readonly PresetTemplate[];
	categories: readonly PresetCategory[];
}): SetupPresetOutput {
	const dollar = p.style === "EVERY_DOLLAR";
	return {
		style: p.style,
		currency: p.currency,
		groups: [...(dollar ? GROUPS.EVERY_DOLLAR : GROUPS.FLEX)],
		envelopes: dollar
			? everyDollar(p.templates, p.categories)
			: flex(p.style, p.templates),
	};
}
