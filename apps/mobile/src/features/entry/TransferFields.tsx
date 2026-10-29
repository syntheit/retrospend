import { View } from "react-native";
import { useTranslations } from "use-intl";
import { groupOf } from "@/features/wealth/accounts";
import type { Account } from "@/features/wealth/source";
import { useTheme } from "@/theme";
import { ListGroup, SectionHeader } from "@/ui/List";
import { Text } from "@/ui/Text";
import { FieldError, TextField } from "@/ui/TextField";
import { DateRow } from "./DateRow";
import type { TransferDraft, TransferErrors } from "./draft";
import { PickField } from "./PickField";
import type { EntryPlace } from "./types";

/**
 * The dot of an account's group: the same series color the Wealth page uses
 * for the group, so the account is known by where it sits. Liabilities stay
 * neutral. A type the groups do not know reads as cash.
 */
function GroupDot({ type }: { type: string }) {
	const { color, radius, space } = useTheme();
	const group = groupOf(type as Account["type"]) ?? "cash";
	const fill =
		group === "cash"
			? color.series1
			: group === "investments"
				? color.series2
				: group === "crypto"
					? color.series3
					: group === "property"
						? color.series4
						: color.fg3;
	return (
		<View
			style={{
				width: space[2],
				height: space[2],
				borderRadius: radius.chip,
				backgroundColor: fill,
			}}
		/>
	);
}

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
	exchange,
	onChange,
}: {
	draft: TransferDraft;
	places: EntryPlace[];
	/** Shown once Add was pressed. */
	errors: TransferErrors;
	/** The accounts are in two currencies. */
	exchange: boolean;
	onChange: (patch: Partial<TransferDraft>) => void;
}) {
	const t = useTranslations("mobile.composer.transfer");
	const tp = useTranslations("mobile.pickers");
	const { space } = useTheme();
	const from = places.find((p) => p.id === draft.fromId);
	const rows = places.map((p) => ({
		id: p.id,
		label: p.name,
		detail: p.currency,
		lead: <GroupDot type={p.type} />,
	}));
	return (
		<View style={{ gap: space[2] }}>
			<ListGroup>
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
			</ListGroup>
			{errors.same ? <FieldError>{t("errors.same")}</FieldError> : null}
			{errors.places ? <FieldError>{t("errors.places")}</FieldError> : null}
			{errors.received ? <FieldError>{t("errors.received")}</FieldError> : null}
			{exchange ? (
				<Text tone="fg2" variant="small">
					{t("receivedHint")}
				</Text>
			) : null}
		</View>
	);
}

/** Transfer in More: the day and a note. */
export function TransferDetails({
	draft,
	onChange,
	onTypingChange,
}: {
	draft: TransferDraft;
	onChange: (patch: Partial<TransferDraft>) => void;
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer.transfer");
	const tc = useTranslations("mobile.composer");
	const { space } = useTheme();
	return (
		<View>
			<View style={{ paddingTop: space[1] }}>
				<ListGroup>
					<DateRow
						label={tc("dateField")}
						onChange={(date) => onChange({ date })}
						value={draft.date}
					/>
				</ListGroup>
			</View>
			<SectionHeader title={tc("details")} />
			<View style={{ paddingHorizontal: space[4] }}>
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
