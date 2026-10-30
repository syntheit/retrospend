import { View } from "react-native";
import { useTranslations } from "use-intl";
import { AccountDot } from "@/features/wealth/AccountDot";
import { useTheme } from "@/theme";
import { ListGroup } from "@/ui/List";
import { PickField } from "@/ui/PickField";
import { FieldError, TextField } from "@/ui/TextField";
import { DateRow } from "./DateRow";
import type { TransferDraft, TransferErrors } from "./draft";
import type { EntryPlace } from "./types";

/**
 * The quick step of Transfer: your own money between two of your accounts,
 * each account led by its group dot. Between two currencies it is an
 * exchange: what arrived is typed in the amount card's second row, and the
 * server books the reference rate for what you leave empty.
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
	onTypingChange: (typing: boolean) => void;
	onChange: (patch: Partial<TransferDraft>) => void;
}) {
	const t = useTranslations("mobile.composer.transfer");
	const tp = useTranslations("mobile.pickers");
	const { size, space } = useTheme();
	const from = places.find((p) => p.id === draft.fromId);
	const rows = places.map((p) => ({
		id: p.id,
		label: p.name,
		detail: p.currency,
		lead: <AccountDot type={p.type} />,
	}));
	return (
		<View style={{ gap: space[2] }}>
			<View style={{ marginHorizontal: -size.gutter.phone }}>
				<ListGroup form>
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
								...(next?.currency !== from?.currency
									? { amountText: "" }
									: {}),
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
				</ListGroup>
			</View>
			{errors.same ? <FieldError>{t("errors.same")}</FieldError> : null}
			{errors.places ? <FieldError>{t("errors.places")}</FieldError> : null}
			{errors.received ? <FieldError>{t("errors.received")}</FieldError> : null}
			<View style={{ paddingTop: space[1] }}>
				<TextField
					autoCapitalize="sentences"
					label={t("note")}
					onChangeText={(note) => onChange({ note })}
					onTypingChange={onTypingChange}
					placeholder={t("notePlaceholder")}
					value={draft.note}
				/>
			</View>
		</View>
	);
}

/** Transfer in More: the day. */
export function TransferDetails({
	draft,
	onChange,
}: {
	draft: TransferDraft;
	onChange: (patch: Partial<TransferDraft>) => void;
}) {
	const tc = useTranslations("mobile.composer");
	const { space } = useTheme();
	return (
		<View style={{ paddingTop: space[1] }}>
			<ListGroup form>
				<DateRow
					label={tc("dateField")}
					onChange={(date) => onChange({ date })}
					value={draft.date}
				/>
			</ListGroup>
		</View>
	);
}
