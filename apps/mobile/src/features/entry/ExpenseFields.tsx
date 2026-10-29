import { dayKey } from "@retrospend/domain/time-zone";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { Cover } from "@/features/projects/Cover";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { DateField } from "@/ui/DateField";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { SwitchRow } from "@/ui/SwitchRow";
import { CategoryPicker } from "./CategoryPicker";
import { Chip } from "./Chip";
import { recentCategories } from "./catalog";
import { shiftDay } from "./dates";
import {
	type ExpenseDraft,
	type ExpenseErrors,
	isPersonal,
	LOCATION_LIMIT,
	NOTE_LIMIT,
	SHARED_NOTE_LIMIT,
	SPREAD_MONTHS,
	type SplitRow,
} from "./draft";
import { Face } from "./Face";
import { PickField } from "./PickField";
import type { EntryCatalog } from "./types";
import { personKey } from "./types";

const RECENTS = 4;

/** A field's label above it, in the small muted style. */
export function FieldLabel({ children }: { children: string }) {
	const { color, type } = useTheme();
	return (
		<Text style={{ color: color.fg2, fontSize: type.small.size }}>
			{children}
		</Text>
	);
}

export function FieldError({ children }: { children: string }) {
	const { color, type } = useTheme();
	return (
		<Text
			accessibilityRole="alert"
			style={{ color: color.danger, fontSize: type.small.size }}
		>
			{children}
		</Text>
	);
}

/** The text field every composer uses: 44 high, a visible border, token colors. */
export function TextField({
	label,
	value,
	onChangeText,
	placeholder,
	onTypingChange,
	invalid,
	hideLabel,
	keyboardType,
	maxLength,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	placeholder: string;
	onTypingChange: (typing: boolean) => void;
	invalid?: boolean;
	/** The placeholder says it; screen readers still get the label. */
	hideLabel?: boolean;
	keyboardType?: "default" | "decimal-pad";
	maxLength?: number;
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			{hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
			<TextInput
				accessibilityLabel={label}
				keyboardType={keyboardType}
				maxLength={maxLength}
				onBlur={() => onTypingChange(false)}
				onChangeText={onChangeText}
				onFocus={() => onTypingChange(true)}
				placeholder={placeholder}
				placeholderTextColor={color.fg3}
				returnKeyType="done"
				style={{
					minHeight: size.touchMin.phone,
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: invalid ? color.danger : color.lineStrong,
					backgroundColor: color.surface,
					color: color.fg,
					fontSize: type.section.size,
				}}
				value={value}
			/>
		</View>
	);
}

/**
 * Note, Location, Spread over and Exclude, behind one "More details" button
 * so the main composer stays short. It opens by itself when a field holds a
 * value (an edit of a saved expense).
 */
function MoreDetails({
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
	const filled =
		draft.note !== "" ||
		(personal &&
			(draft.location !== "" || draft.spread !== null || draft.exclude));
	const [open, setOpen] = useState(filled);
	// A saved odd spread (say 4 months) stays offered next to the usual ones.
	const months = [
		...new Set([...SPREAD_MONTHS, ...(draft.spread ? [draft.spread] : [])]),
	].sort((a, b) => a - b);
	return (
		<View style={{ gap: space[3] }}>
			<View style={{ flexDirection: "row" }}>
				<Chip
					label={t("moreDetails")}
					onPress={() => setOpen(!open)}
					selected={open}
				/>
			</View>
			{open ? (
				<>
					<TextField
						label={t("note")}
						maxLength={personal ? NOTE_LIMIT : SHARED_NOTE_LIMIT}
						onChangeText={(note) => onChange({ note })}
						onTypingChange={onTypingChange}
						placeholder={t("notePlaceholder")}
						value={draft.note}
					/>
					{personal ? (
						<>
							<TextField
								label={t("location")}
								maxLength={LOCATION_LIMIT}
								onChangeText={(location) => onChange({ location })}
								onTypingChange={onTypingChange}
								placeholder={t("locationPlaceholder")}
								value={draft.location}
							/>
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
							<SwitchRow
								detail={t("excludeDetail")}
								label={t("exclude")}
								onChange={(exclude) => onChange({ exclude })}
								value={draft.exclude}
							/>
						</>
					) : null}
				</>
			) : null}
		</View>
	);
}

export function ExpenseFields({
	draft,
	onChange,
	catalog,
	errors,
	rows,
	onTypingChange,
	onProject,
}: {
	/** Picks (or clears) the project; the composer loads its people. */
	onProject: (projectId: string | null) => void;
	draft: ExpenseDraft;
	onChange: (patch: Partial<ExpenseDraft>) => void;
	catalog: EntryCatalog;
	/** Shown once Add was pressed. */
	errors: ExpenseErrors;
	rows: SplitRow[];
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { format } = useFormatMoney();
	const { color, size, space, type } = useTheme();
	const recents = recentCategories(catalog, RECENTS, draft.categoryId);
	const editing = draft.editing !== null;
	// Someone else's category on their split: not in your catalog, but kept.
	const saved =
		draft.editing?.category &&
		!catalog.categories.some((c) => c.id === draft.editing?.category?.id)
			? draft.editing.category
			: null;
	const today = dayKey(new Date());
	// In a project the split is about the project's people, not your latest ones.
	const people = draft.projectId ? draft.projectPeople : catalog.people;
	const projects = editing ? [] : catalog.projects;
	const row = {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space[2],
	} as const;

	function togglePerson(key: string) {
		onChange({
			withKeys: draft.withKeys.includes(key)
				? draft.withKeys.filter((k) => k !== key)
				: [...draft.withKeys, key],
		});
	}

	return (
		<>
			<TextField
				hideLabel
				label={t("titleField")}
				onChangeText={(title) => onChange({ title })}
				onTypingChange={onTypingChange}
				placeholder={t("titlePlaceholder")}
				value={draft.title}
			/>
			<View style={{ gap: space[2] }}>
				<FieldLabel>{t("category")}</FieldLabel>
				<View style={[row, { alignItems: "center" }]}>
					{saved ? (
						<Chip
							label={saved.name}
							onPress={() => onChange({ categoryId: saved.id })}
							selected={draft.categoryId === saved.id}
						/>
					) : null}
					{recents.map((category) => (
						<Chip
							key={category.id}
							label={category.name}
							leading={
								<CategoryGlyph
									category={category}
									color={categoryColor(color, category.tone)}
									size={size.icon.phone}
								/>
							}
							onPress={() => onChange({ categoryId: category.id })}
							selected={draft.categoryId === category.id}
						/>
					))}
					{catalog.categories.length > recents.length ? (
						<CategoryPicker
							categories={catalog.categories}
							onChange={(categoryId) => onChange({ categoryId })}
							recent={recents}
							value={draft.categoryId}
						/>
					) : null}
				</View>
				{errors.category ? (
					<FieldError>{t("errors.category")}</FieldError>
				) : null}
			</View>
			<View style={{ gap: space[2] }}>
				<DateField
					label={t("dateField")}
					onChange={(day) => onChange({ date: day })}
					value={draft.date}
				/>
				<View style={row}>
					<Chip
						label={t("today")}
						onPress={() => onChange({ date: today })}
						selected={draft.date === today}
					/>
					<Chip
						label={t("yesterday")}
						onPress={() => onChange({ date: shiftDay(today, -1) })}
						selected={draft.date === shiftDay(today, -1)}
					/>
				</View>
			</View>
			{projects.length > 0 ? (
				<PickField
					empty={t("project.empty")}
					find={t("project.find")}
					label={t("project.label")}
					none={{ label: t("project.none"), lead: null }}
					onChange={onProject}
					rows={projects.map((p) => ({
						id: p.id,
						label: p.name,
						detail: p.currency,
						lead: (
							<Cover
								diameter={size.avatar.sm}
								id={p.id}
								imageUri={p.imageUrl}
								name={p.name}
							/>
						),
					}))}
					title={t("project.label")}
					value={draft.projectId}
				/>
			) : null}
			{!editing && people.length > 0 ? (
				<View style={{ gap: space[2] }}>
					<FieldLabel>{t("with")}</FieldLabel>
					<View style={row}>
						{people.slice(0, 8).map((person) => {
							const key = personKey(person);
							return (
								<Chip
									accessibilityLabel={person.name}
									key={key}
									label={person.name.split(/\s+/)[0] ?? person.name}
									leading={
										<Face
											diameter={size.avatar.xs}
											imageUrl={person.imageUrl}
											name={person.name}
											seed={key}
										/>
									}
									onPress={() => togglePerson(key)}
									selected={draft.withKeys.includes(key)}
								/>
							);
						})}
					</View>
				</View>
			) : null}
			{!editing && rows.length > 0 ? (
				<View style={{ gap: space[1] }}>
					<Text
						accessibilityRole="header"
						style={{
							color: color.fg,
							fontSize: type.section.size,
							fontWeight: "600",
						}}
					>
						{t("splitEqually")}
					</Text>
					{rows.map((r) => (
						<View
							accessible
							key={r.key}
							style={{
								minHeight: size.row.phone,
								flexDirection: "row",
								alignItems: "center",
								gap: space[3],
							}}
						>
							<Face
								diameter={size.avatar.default}
								imageUrl={r.person?.imageUrl}
								name={r.name}
								seed={r.person ? personKey(r.person) : r.key}
							/>
							<Text
								numberOfLines={1}
								style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
							>
								{r.name}
							</Text>
							{/* The server's share; nothing until its dry run answers. */}
							{r.share ? (
								<Text
									style={{
										color: color.fg,
										fontSize: type.body.size,
										fontVariant: ["tabular-nums"],
										fontWeight: "500",
										textAlign: "right",
									}}
								>
									{format(r.share, { cents: true }) ?? ""}
								</Text>
							) : null}
						</View>
					))}
				</View>
			) : null}
			<MoreDetails
				draft={draft}
				onChange={onChange}
				onTypingChange={onTypingChange}
			/>
		</>
	);
}
