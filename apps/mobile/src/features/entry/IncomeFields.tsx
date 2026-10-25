import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "./Chip";
import type { IncomeDraft, IncomeErrors } from "./draft";
import { Face } from "./Face";
import { FieldError, FieldLabel, TextField } from "./ExpenseFields";
import { type EntryCatalog, personKey } from "./types";

/**
 * Add income: who paid you, and whether the money waits as Not planned yet
 * or goes by your plan. No account is picked here, so it lands in your
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
		<>
			<View style={{ gap: space[2] }}>
				<TextField
					invalid={errors.source}
					label={t("from")}
					onChangeText={(source) => onChange({ source })}
					onTypingChange={onTypingChange}
					placeholder={t("fromPlaceholder")}
					value={draft.source}
				/>
				{errors.source ? <FieldError>{t("errors.source")}</FieldError> : null}
				{catalog.people.length > 0 ? (
					<View
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
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
			</View>
			{catalog.hasBudget ? (
				<View style={{ gap: space[2] }}>
					<FieldLabel>{t("afterSaving")}</FieldLabel>
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
			) : null}
		</>
	);
}
