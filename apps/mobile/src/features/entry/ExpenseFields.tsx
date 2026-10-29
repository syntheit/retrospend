import { dayKey } from "@retrospend/domain/time-zone";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { Cover } from "@/features/projects/Cover";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { SwitchRow } from "@/ui/SwitchRow";
import { FieldError, FieldLabel, TextField } from "@/ui/TextField";
import { CategoryPicker } from "./CategoryPicker";
import { recentCategories } from "./catalog";
import { shiftDay } from "./dates";
import {
	type ExpenseDraft,
	type ExpenseErrors,
	isPersonal,
	LOCATION_LIMIT,
	NOTE_LIMIT,
	pickCategory,
	SHARED_NOTE_LIMIT,
	SPREAD_MONTHS,
	type SplitRow,
} from "./draft";
import { Face } from "./Face";
import { PickField } from "./PickField";
import type { EntryCatalog } from "./types";
import { personKey } from "./types";

const RECENTS = 4;

/** A section's name above its fields, in the section style (sentence case). */
export function SectionTitle({ children }: { children: string }) {
	const { color, type } = useTheme();
	return (
		<Text
			accessibilityRole="header"
			style={{
				color: color.fg,
				fontSize: type.section.size,
				fontWeight: "600",
			}}
		>
			{children}
		</Text>
	);
}

/**
 * Details: Note, and for an expense of yours alone Location, Spread over and
 * Exclude from spending, the web composer's options. They are always shown
 * under their own title: a "More details" toggle at the foot of the scroll,
 * under the keypad, was too easy to miss (owner, 2026-10-29). A split keeps
 * its note only, as on the web.
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
		<View style={{ gap: space[3] }}>
			<SectionTitle>{t("details")}</SectionTitle>
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
				<>
					<TextField
						autoCapitalize="sentences"
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
						detail={
							draft.excludeAuto && draft.exclude
								? t("excludeAuto")
								: t("excludeDetail")
						}
						label={t("exclude")}
						onChange={(exclude) =>
							onChange({ exclude, excludeTouched: true, excludeAuto: false })
						}
						value={draft.exclude}
					/>
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
	const { state } = useSession();
	// Your own face on the You row: your picture when you have one.
	const meImage =
		state.status === "signedIn" ? (state.me?.avatarUrl ?? null) : null;
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
				autoCapitalize="sentences"
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
							onPress={() => onChange(pickCategory(draft, undefined, saved.id))}
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
							onPress={() =>
								onChange(pickCategory(draft, category, category.id))
							}
							selected={draft.categoryId === category.id}
						/>
					))}
					{catalog.categories.length > recents.length ? (
						<CategoryPicker
							categories={catalog.categories}
							onChange={(categoryId) =>
								onChange(
									pickCategory(
										draft,
										catalog.categories.find((c) => c.id === categoryId),
										categoryId,
									),
								)
							}
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
								imageUrl={r.person ? r.person.imageUrl : meImage}
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
			<Details
				draft={draft}
				onChange={onChange}
				onTypingChange={onTypingChange}
			/>
		</>
	);
}
