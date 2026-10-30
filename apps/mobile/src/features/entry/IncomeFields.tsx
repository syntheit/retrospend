import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { ListGroup, SectionHeader } from "@/ui/List";
import { FieldError, TextField } from "@/ui/TextField";
import { DateRow } from "./DateRow";
import { type IncomeDraft, type IncomeErrors, NOTE_LIMIT } from "./draft";
import { Face } from "./Face";
import { type EntryCatalog, personKey } from "./types";

/**
 * The quick step of Add income: who paid you, as typed or picked from the
 * people you share with. No account is picked, so the money lands in your
 * budget and your accounts do not change.
 */
export function IncomeFields({
	draft,
	onChange,
	catalog,
	errors,
	onTypingChange,
}: {
	draft: IncomeDraft;
	onChange: (patch: Partial<IncomeDraft>) => void;
	catalog: EntryCatalog;
	errors: IncomeErrors;
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { size, space } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<TextField
				autoCapitalize="sentences"
				invalid={errors.source}
				label={t("from")}
				onChangeText={(source) => onChange({ source })}
				onTypingChange={onTypingChange}
				placeholder={t("fromPlaceholder")}
				value={draft.source}
			/>
			{errors.source ? <FieldError>{t("errors.source")}</FieldError> : null}
			{catalog.people.length > 0 ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
					{catalog.people.slice(0, 6).map((person) => (
						<Chip
							accessibilityLabel={person.name}
							key={personKey(person)}
							label={person.name.split(/\s+/)[0] ?? person.name}
							leading={
								<Face
									diameter={size.avatar.xs}
									imageUrl={person.imageUrl}
									name={person.name}
									seed={personKey(person)}
								/>
							}
							onPress={() => onChange({ source: person.name })}
							selected={draft.source === person.name}
						/>
					))}
				</View>
			) : null}
			<View style={{ paddingTop: space[2] }}>
				<TextField
					autoCapitalize="sentences"
					label={t("note")}
					maxLength={NOTE_LIMIT}
					onChangeText={(note) => onChange({ note })}
					onTypingChange={onTypingChange}
					placeholder={t("notePlaceholder")}
					value={draft.note}
				/>
			</View>
		</View>
	);
}

/**
 * Income in More: the day, and whether the money waits as Not planned yet or
 * goes by your plan. The note is on the main step.
 */
export function IncomeDetails({
	draft,
	onChange,
	catalog,
}: {
	draft: IncomeDraft;
	onChange: (patch: Partial<IncomeDraft>) => void;
	catalog: EntryCatalog;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const gutter = { paddingHorizontal: space[4] } as const;
	return (
		<View>
			<View style={{ paddingTop: space[1] }}>
				<ListGroup form>
					<DateRow
						label={t("dateField")}
						onChange={(date) => onChange({ date })}
						value={draft.date}
					/>
				</ListGroup>
			</View>
			{catalog.hasBudget ? (
				<>
					<SectionHeader title={t("afterSaving")} />
					<View style={{ ...gutter, gap: space[2] }}>
						<View
							accessibilityLabel={t("afterSaving")}
							accessibilityRole="radiogroup"
							style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
						>
							<Chip
								label={t("notPlannedYet")}
								onPress={() => onChange({ usePlan: false })}
								selected={!draft.usePlan}
							/>
							<Chip
								label={t("usePlan")}
								onPress={() => onChange({ usePlan: true })}
								selected={draft.usePlan}
							/>
						</View>
					</View>
				</>
			) : null}
		</View>
	);
}
