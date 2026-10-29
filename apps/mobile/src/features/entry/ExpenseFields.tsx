import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { CategoryRow } from "./CategoryRow";
import type { ExpenseDraft, ExpenseErrors } from "./draft";
import { FaceRow } from "./FaceRow";
import { TitleCard } from "./TitleCard";
import type { EntryCatalog, EntryPerson } from "./types";

type Money = { minor: number; currency: string };

/** How a split divides, as the server names it. */
export type SplitModeName = "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";

/**
 * One line under the faces that says how it is split and what your part is.
 * The share is the server's, from the dry run; until it answers the line
 * says only how it is split.
 */
export function SplitSummary({
	mode,
	yourShare,
}: {
	mode: SplitModeName;
	yourShare: Money | null;
}) {
	const t = useTranslations("mobile.composer.split");
	const { format } = useFormatMoney();
	const split = t(`summary.${mode}`);
	const amount = yourShare ? format(yourShare, { cents: true }) : null;
	return (
		<Text accessibilityLiveRegion="polite" tone="fg2">
			{amount ? t("summaryShare", { split, amount }) : split}
		</Text>
	);
}

/**
 * The quick step of an expense: who it is split with, the title and day, and
 * the category. Everything else (project, split rows, rate, options, note)
 * is in More.
 */
export function ExpenseFields({
	draft,
	catalog,
	people,
	errors,
	split,
	onChange,
	onTypingChange,
	onMore,
}: {
	draft: ExpenseDraft;
	catalog: EntryCatalog;
	/** Everyone the split can name: the catalog's, or the project's. */
	people: EntryPerson[];
	/** Shown once Add was pressed. */
	errors: ExpenseErrors;
	/** How it is split and your part, from the dry run; null when it is yours alone. */
	split: { mode: SplitModeName; yourShare: Money | null } | null;
	onChange: (patch: Partial<ExpenseDraft>) => void;
	onTypingChange: (typing: boolean) => void;
	/** Opens More (the calendar is there). */
	onMore: () => void;
}) {
	const { space } = useTheme();
	const editing = draft.editing !== null;

	function togglePerson(key: string) {
		onChange({
			withKeys: draft.withKeys.includes(key)
				? draft.withKeys.filter((k) => k !== key)
				: [...draft.withKeys, key],
		});
	}

	return (
		<View style={{ gap: space[4] }}>
			{!editing && people.length > 0 ? (
				<FaceRow
					onToggle={togglePerson}
					people={people}
					selected={draft.withKeys}
				/>
			) : null}
			{split ? (
				<SplitSummary mode={split.mode} yourShare={split.yourShare} />
			) : null}
			<TitleCard
				date={draft.date}
				onDateChange={(date) => onChange({ date })}
				onPickDate={onMore}
				onTitleChange={(title) => onChange({ title })}
				onTypingChange={onTypingChange}
				title={draft.title}
			/>
			<CategoryRow
				catalog={catalog}
				draft={draft}
				error={errors.category === true}
				onChange={onChange}
			/>
		</View>
	);
}
