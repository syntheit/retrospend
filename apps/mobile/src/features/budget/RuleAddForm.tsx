import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { useToast } from "@/ui/Toast";
import { minorOf, readAmount } from "./amount";
import { ChoiceList, TextField } from "./fields";
import { AmountField, Note, useAmountLocale } from "./parts";
import { createRuleBody, type RuleKind } from "./rulesBody";
import { type BudgetMonth, envelopesOf } from "./source";
import { useWriteIds } from "./useMoneyWrite";

/**
 * Add an income rule: what happens to money that arrives from now on. It
 * moves no money when it is made, so there is no dry run; the toast takes it
 * back by archiving it again.
 */
export function RuleAddForm({
	data,
	onAdded,
	onClose,
}: {
	data: BudgetMonth;
	onAdded: () => void;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.rules.editor");
	const tc = useTranslations("mobile.common");
	const tw = useTranslations("mobile.budget.write");
	const { api } = useSession();
	const toast = useToast();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const currency = data.book.currency;
	const [name, setName] = useState("");
	const [kind, setKind] = useState<RuleKind>("PERCENT");
	const [percent, setPercent] = useState("");
	const [draft, setDraft] = useState("");
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const minor = minorOf(readAmount(draft, locale, currency));
	const { idFor } = useWriteIds(
		JSON.stringify([name, kind, percent, minor, envelopeId]),
	);
	const body = createRuleBody({
		id: idFor("rule"),
		name,
		kind,
		percentText: percent,
		minor,
		currency,
		envelopeId,
	});

	async function save() {
		if (!api || !body || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			await api.budget.createRule(body, {
				context: { idempotencyKey: body.id },
			});
		} catch {
			setFailed(true);
			setBusy(false);
			return;
		}
		setBusy(false);
		onAdded();
		toast.show({
			message: t("toast", { name: body.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					try {
						await api.budget.archiveRule(
							{ id: body.id },
							{ context: { idempotencyKey: newClientId() } },
						);
						toast.show({ message: tw("undone") });
						onAdded();
					} catch {
						toast.show({ message: tw("undoError") });
					}
				},
			},
		});
		onClose();
	}

	return (
		<View style={{ gap: space[4] }}>
			<TextField
				label={t("name")}
				maxLength={64}
				onChangeText={setName}
				value={name}
			/>
			<Segmented
				accessibilityLabel={t("kind")}
				onChange={setKind}
				options={[
					{ value: "PERCENT", label: t("percent") },
					{ value: "AMOUNT", label: t("amount") },
					{ value: "REMAINDER", label: t("rest") },
				]}
				value={kind}
			/>
			{kind === "PERCENT" ? (
				<TextField
					label={t("percentLabel")}
					maxLength={6}
					onChangeText={setPercent}
					value={percent}
				/>
			) : null}
			{kind === "AMOUNT" ? (
				<AmountField
					currency={currency}
					draft={draft}
					entered={readAmount(draft, locale, currency)}
					label={t("amountLabel")}
					onDraftChange={setDraft}
				/>
			) : null}
			<ChoiceList
				choices={envelopesOf(data).map((e) => ({ id: e.id, label: e.name }))}
				label={t("goesTo")}
				onPress={setEnvelopeId}
				selected={new Set(envelopeId ? [envelopeId] : [])}
			/>
			<Note>{t("note")}</Note>
			{failed ? <Note tone="attention">{tw("error")}</Note> : null}
			<Button
				disabled={!body || busy}
				label={busy ? tw("saving") : t("add")}
				onPress={() => void save()}
			/>
		</View>
	);
}
