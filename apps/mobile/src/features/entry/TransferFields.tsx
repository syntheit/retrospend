import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { DateField } from "@/ui/DateField";
import type { TransferDraft, TransferErrors } from "./draft";
import { FieldError, TextField } from "./ExpenseFields";
import { PickField } from "./PickField";
import type { EntryPlace } from "./types";

/**
 * Transfer: your own money between two of your accounts. Two currencies make
 * it an exchange; what arrived is optional, and the server books the
 * reference rate for what you leave empty.
 */
export function TransferFields({
	draft,
	places,
	errors,
	onChange,
	onTypingChange,
}: {
	draft: TransferDraft;
	places: EntryPlace[];
	/** Shown once Add was pressed. */
	errors: TransferErrors;
	onChange: (patch: Partial<TransferDraft>) => void;
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer.transfer");
	const tc = useTranslations("mobile.composer");
	const tp = useTranslations("mobile.pickers");
	const { color, space, type } = useTheme();
	const to = places.find((p) => p.id === draft.toId);
	const from = places.find((p) => p.id === draft.fromId);
	const exchange = Boolean(from && to && from.currency !== to.currency);
	const rows = places.map((p) => ({
		id: p.id,
		label: p.name,
		detail: p.currency,
		lead: null,
	}));
	return (
		<>
			<PickField
				empty={tp("account.empty")}
				find={tp("account.find")}
				label={t("from")}
				onChange={(id) => {
					// A new currency makes the typed digits meaningless.
					const next = places.find((p) => p.id === id);
					onChange({
						fromId: id,
						receivedText: "",
						...(next?.currency !== from?.currency ? { amountText: "" } : {}),
					});
				}}
				rows={rows}
				title={t("from")}
				value={draft.fromId}
			/>
			<PickField
				empty={tp("account.empty")}
				find={tp("account.find")}
				label={t("to")}
				onChange={(id) => onChange({ toId: id, receivedText: "" })}
				rows={rows}
				title={t("to")}
				value={draft.toId}
			/>
			{errors.same ? <FieldError>{t("errors.same")}</FieldError> : null}
			{errors.places ? <FieldError>{t("errors.places")}</FieldError> : null}
			{exchange && to ? (
				<View style={{ gap: space[2] }}>
					<TextField
						keyboardType="decimal-pad"
						label={t("received", { currency: to.currency })}
						onChangeText={(receivedText) => onChange({ receivedText })}
						onTypingChange={onTypingChange}
						placeholder={t("receivedPlaceholder")}
						value={draft.receivedText}
					/>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("receivedHint")}
					</Text>
				</View>
			) : null}
			<TextField
				label={t("note")}
				onChangeText={(note) => onChange({ note })}
				onTypingChange={onTypingChange}
				placeholder={t("notePlaceholder")}
				value={draft.note}
			/>
			<DateField
				label={tc("dateField")}
				onChange={(date) => onChange({ date })}
				value={draft.date}
			/>
		</>
	);
}
