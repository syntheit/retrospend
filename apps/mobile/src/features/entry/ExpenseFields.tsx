import { Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { CategoryPicker } from "./CategoryPicker";
import { Chip } from "./Chip";
import { recentCategories } from "./catalog";
import type { ExpenseDraft, ExpenseErrors, SplitRow } from "./draft";
import { Face } from "./Face";
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
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	placeholder: string;
	onTypingChange: (typing: boolean) => void;
	invalid?: boolean;
	/** The placeholder says it; screen readers still get the label. */
	hideLabel?: boolean;
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			{hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
			<TextInput
				accessibilityLabel={label}
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

export function ExpenseFields({
	draft,
	onChange,
	catalog,
	errors,
	rows,
	onTypingChange,
}: {
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
			{catalog.people.length > 0 ? (
				<View style={{ gap: space[2] }}>
					<FieldLabel>{t("with")}</FieldLabel>
					<View style={row}>
						{catalog.people.slice(0, 8).map((person) => {
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
			{rows.length > 0 ? (
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
							<Text
								style={{
									color: color.fg,
									fontSize: type.body.size,
									fontVariant: ["tabular-nums"],
									fontWeight: "500",
									textAlign: "right",
								}}
							>
								{format(
									{ minor: r.minor, currency: draft.currency },
									{ cents: true },
								) ?? ""}
							</Text>
						</View>
					))}
				</View>
			) : null}
		</>
	);
}
