import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { GroupItem, ListGroup } from "@/ui/List";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { FieldLabel, TextField } from "@/ui/TextField";
import { CategoryRow } from "./CategoryRow";
import {
	type ExpenseDraft,
	type ExpenseErrors,
	isPersonal,
	LOCATION_LIMIT,
	NOTE_LIMIT,
	SHARED_NOTE_LIMIT,
	SPREAD_MONTHS,
} from "./draft";
import { FaceRow } from "./FaceRow";
import type { SplitMode } from "./splitParts";
import { TitleCard } from "./TitleCard";
import type { EntryCatalog, EntryPerson } from "./types";

type Money = { minor: number; currency: string };

/** How a split divides, as the server names it. */
export type SplitModeName = SplitMode;

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
 * Spread, Exclude, Note and Location, always shown at the foot of the main
 * step, with no toggle, each under its own label. There are no section
 * headings: the labels say what each row is, and the headings would push the
 * rows below the keypad. A split keeps its note only, as on the web.
 */
function Details({
	draft,
	onChange,
	onTypingChange,
}: {
	draft: ExpenseDraft;
	onChange: (patch: Partial<ExpenseDraft>) => void;
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const personal = isPersonal(draft);
	// A saved odd spread (say 4 months) stays offered next to the usual ones.
	const months = [
		...new Set([...SPREAD_MONTHS, ...(draft.spread ? [draft.spread] : [])]),
	].sort((a, b) => a - b);
	return (
		<View style={{ gap: space[4] }}>
			{personal ? (
				<ListGroup form>
					<GroupItem>
						<View style={{ gap: space[2] }}>
							<FieldLabel>{t("spread")}</FieldLabel>
							<View
								accessibilityLabel={t("spread")}
								accessibilityRole="radiogroup"
								style={{
									flexDirection: "row",
									flexWrap: "wrap",
									gap: space[2],
								}}
							>
								<Chip
									label={t("spreadOne")}
									onPress={() => onChange({ spread: null })}
									selected={draft.spread === null}
								/>
								{months.map((count) => (
									<Chip
										key={count}
										label={t("spreadMonths", { count })}
										onPress={() => onChange({ spread: count })}
										selected={draft.spread === count}
									/>
								))}
							</View>
						</View>
					</GroupItem>
					<GroupItem>
						<View>
							<SwitchRow
								detail={
									draft.excludeAuto && draft.exclude
										? t("excludeAuto")
										: t("excludeDetail")
								}
								label={t("exclude")}
								onChange={(exclude) =>
									onChange({
										exclude,
										excludeTouched: true,
										excludeAuto: false,
									})
								}
								value={draft.exclude}
							/>
						</View>
					</GroupItem>
				</ListGroup>
			) : null}
			<View style={{ paddingHorizontal: space[4], gap: space[3] }}>
				<TextField
					autoCapitalize="sentences"
					label={t("note")}
					maxLength={personal ? NOTE_LIMIT : SHARED_NOTE_LIMIT}
					onChangeText={(note) => onChange({ note })}
					onTypingChange={onTypingChange}
					placeholder={t("notePlaceholder")}
					value={draft.note}
				/>
				{personal ? (
					<TextField
						autoCapitalize="sentences"
						label={t("location")}
						maxLength={LOCATION_LIMIT}
						onChangeText={(location) => onChange({ location })}
						onTypingChange={onTypingChange}
						placeholder={t("locationPlaceholder")}
						value={draft.location}
					/>
				) : null}
			</View>
		</View>
	);
}

/**
 * The main step of an expense: who it is split with, the title and day, the
 * category, and the Details (spread, exclude, note, place). The project, split
 * rows and rate are in More.
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
			>
				<CategoryRow
					catalog={catalog}
					draft={draft}
					error={errors.category === true}
					onChange={onChange}
				/>
			</TitleCard>
			<Details
				draft={draft}
				onChange={onChange}
				onTypingChange={onTypingChange}
			/>
		</View>
	);
}
