import { categoryTone } from "@retrospend/domain/category-tone";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { AccountDot } from "@/features/wealth/AccountDot";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickerSheet } from "@/ui/PickerSheet";
import { PickField } from "@/ui/PickField";
import type { PickRow } from "@/ui/pickGroups";
import { FieldLabel } from "@/ui/TextField";
import type { BudgetEnvelope } from "./source";

/**
 * The pickers of the budget sheets. Each is a flat-form field: the label
 * above, then the one picker trigger (identity, name) that opens the shared
 * picker sheet with a search field. Envelopes lead with their bare glyph in
 * their color, accounts with their group dot (GUIDELINE 8).
 */

/** A form field: the label above its trigger, flush left. */
export function PickLabeled({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[2], alignItems: "flex-start" }}>
			<FieldLabel>{label}</FieldLabel>
			{children}
		</View>
	);
}

/** A place that is not an envelope but can stand in a list of them (the pool). */
export interface ExtraPlace {
	id: string;
	name: string;
	/** Already formatted (what the place holds). */
	detail?: string;
}

/** The envelope's bare glyph in its own color. */
export function useEnvelopeLead() {
	const { color, size } = useTheme();
	return (e: Pick<BudgetEnvelope, "name" | "icon" | "color">) => (
		<CategoryGlyph
			category={{ name: e.name, icon: e.icon }}
			color={categoryColor(color, categoryTone(e.color ?? ""))}
			size={size.icon.phone}
		/>
	);
}

/**
 * Pick an envelope (and, ahead of them, places like the pool). Each row says
 * what the envelope has left. While nothing is picked the trigger says
 * `placeholder`; `none` adds a first row that clears the choice.
 */
export function EnvelopePick({
	label,
	envelopes,
	extras = [],
	value,
	onChange,
	none,
	placeholder,
	detailOf,
}: {
	label: string;
	envelopes: readonly BudgetEnvelope[];
	extras?: ExtraPlace[];
	/** The line under each name when it is not what the envelope has left. */
	detailOf?: (envelope: BudgetEnvelope) => string;
	value: string | null;
	onChange: (id: string | null) => void;
	none?: { label: string };
	placeholder?: string;
}) {
	const t = useTranslations("mobile.budget.pick");
	const money = useMoneyText();
	const leadOf = useEnvelopeLead();
	return (
		<PickLabeled label={label}>
			<PickField
				empty={t("envelopeEmpty")}
				find={t("envelopeFind")}
				label={label}
				none={none ? { label: none.label, lead: null } : undefined}
				onChange={onChange}
				placeholder={placeholder}
				rows={[
					...extras.map((x) => ({
						id: x.id,
						label: x.name,
						detail: x.detail,
						lead: null,
					})),
					...envelopes.map((e) => ({
						id: e.id,
						label: e.name,
						detail: detailOf ? detailOf(e) : money(e.left),
						lead: leadOf(e),
					})),
				]}
				title={label}
				value={value}
				variant="pill"
			/>
		</PickLabeled>
	);
}

/** An account a picker offers: its name, its type (for the group dot) and a line under the name. */
export interface PickAccount {
	id: string;
	name: string;
	type: string;
	detail?: string;
}

/** Pick an account, each led by its group dot. `none` adds a first row for "not tracked". */
export function AccountPick({
	label,
	accounts,
	value,
	onChange,
	none,
}: {
	label: string;
	accounts: readonly PickAccount[];
	value: string | null;
	onChange: (id: string | null) => void;
	none?: { label: string };
}) {
	const tp = useTranslations("mobile.pickers");
	return (
		<PickLabeled label={label}>
			<PickField
				empty={tp("account.empty")}
				find={tp("account.find")}
				label={label}
				none={none ? { label: none.label, lead: null } : undefined}
				onChange={onChange}
				rows={accounts.map((a) => ({
					id: a.id,
					label: a.name,
					detail: a.detail,
					lead: <AccountDot type={a.type} />,
				}))}
				title={label}
				value={value}
				variant="pill"
			/>
		</PickLabeled>
	);
}

/** Pick one of a few named options with no identity (a budget group). */
export function GroupPick({
	label,
	groups,
	value,
	onChange,
}: {
	label: string;
	groups: readonly { id: string; label: string }[];
	value: string;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("mobile.budget.pick");
	return (
		<PickLabeled label={label}>
			<PickField
				empty={t("groupEmpty")}
				find={t("groupFind")}
				label={label}
				onChange={(id) => id !== null && onChange(id)}
				rows={groups.map((g) => ({ id: g.id, label: g.label, lead: null }))}
				title={label}
				value={value}
				variant="pill"
			/>
		</PickLabeled>
	);
}

/**
 * Pick several from a list: a trigger that says how many, and the picker
 * sheet in its multiple mode (a check per row, Done closes).
 */
export function PickMany({
	label,
	summary,
	find,
	empty,
	rows,
	selected,
	onToggle,
}: {
	label: string;
	/** What the trigger says: "3 categories", or the prompt while none. */
	summary: string;
	find: string;
	empty: string;
	rows: Omit<PickRow, "selected">[];
	selected: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const tp = useTranslations("mobile.pickers");
	const [open, setOpen] = useState(false);
	return (
		<PickLabeled label={label}>
			<Chip
				accessibilityLabel={`${label}, ${summary}`}
				label={summary}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<PickerSheet
				clear={tp("clear")}
				empty={empty}
				find={find}
				groups={[
					{
						key: "all",
						heading: label,
						rows: rows.map((r) => ({ ...r, selected: selected.has(r.id) })),
					},
				]}
				multiple
				onClose={() => setOpen(false)}
				onSelect={onToggle}
				title={label}
				visible={open}
			/>
		</PickLabeled>
	);
}

/** Pick several envelopes (Combine), each with its glyph and what it has left. */
export function EnvelopesPick({
	label,
	envelopes,
	selected,
	onToggle,
}: {
	label: string;
	envelopes: readonly BudgetEnvelope[];
	selected: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const t = useTranslations("mobile.budget.pick");
	const money = useMoneyText();
	const leadOf = useEnvelopeLead();
	return (
		<PickMany
			empty={t("envelopeEmpty")}
			find={t("envelopeFind")}
			label={label}
			onToggle={onToggle}
			rows={envelopes.map((e) => ({
				id: e.id,
				label: e.name,
				detail: money(e.left),
				lead: leadOf(e),
			}))}
			selected={selected}
			summary={
				selected.size > 0
					? t("envelopesCount", { count: selected.size })
					: t("envelopes")
			}
		/>
	);
}
