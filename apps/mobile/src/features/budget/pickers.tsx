import { categoryTone } from "@retrospend/domain/category-tone";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { AccountDot } from "@/features/wealth/AccountDot";
import { useTheme } from "@/theme";
import { CategoryPickerSheet } from "@/ui/CategoryPickerSheet";
import { Chip } from "@/ui/Chip";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickLabeled, PickMany } from "@/ui/PickLabeled";
import { PickField } from "@/ui/PickField";
import type { BudgetEnvelope } from "./source";

/**
 * The pickers of the budget sheets. Each is a flat-form field: the label
 * above, then the one picker trigger (identity, name) that opens the shared
 * picker sheet with a search field. Envelopes open the category picker (the
 * same sheet as the composer's More pill), with their bare glyph in their
 * color; accounts lead with their group dot (GUIDELINE 8).
 */

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
 * `placeholder`; `none` adds a first row that clears the choice. The list is
 * the shared category picker: a full-height, searchable sheet.
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
	const [open, setOpen] = useState(false);
	const categories = useMemo(
		() =>
			envelopes.map((e) => ({
				id: e.id,
				name: e.name,
				icon: e.icon,
				tone: categoryTone(e.color ?? ""),
			})),
		[envelopes],
	);
	const byId = new Map(envelopes.map((e) => [e.id, e]));
	const picked = value === null ? undefined : byId.get(value);
	const extra = extras.find((x) => x.id === value);
	const shown = picked
		? { text: picked.name, lead: leadOf(picked) }
		: extra
			? { text: extra.name, lead: null }
			: none
				? { text: none.label, lead: null }
				: { text: placeholder ?? "", lead: null };
	return (
		<PickLabeled label={label}>
			<Chip
				accessibilityLabel={`${label}, ${shown.text}`}
				label={shown.text}
				leading={shown.lead}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<CategoryPickerSheet
				categories={categories}
				copy={{
					title: label,
					find: t("envelopeFind"),
					empty: t("envelopeEmpty"),
				}}
				detailOf={(c) => {
					const e = byId.get(c.id);
					return e ? (detailOf ? detailOf(e) : money(e.left)) : undefined;
				}}
				extras={extras}
				none={
					none
						? { label: none.label, onPick: () => onChange(null) }
						: undefined
				}
				onChange={(id) => onChange(id)}
				onClose={() => setOpen(false)}
				value={value}
				visible={open}
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
