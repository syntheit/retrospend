import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { LinkButton } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import { minorOf, readAmount } from "./amount";
import {
	linesOf,
	linesWith,
	planBase,
	planBody,
	plannedFor,
} from "./draftsBody";
import { ChoiceList } from "./fields";
import { AmountField, Line, Note, SheetBody, useAmountLocale } from "./parts";
import { type BudgetMonth, envelopeById, envelopesOf } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * Plan a coming month: what each envelope should get when its money arrives.
 * A plan is a draft until payday, so saving one line moves no money and the
 * month itself does not change; Undo puts the previous plan back.
 */
export function PlanSheet({
	data,
	visible,
	onClose,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.planEdit");
	const tw = useTranslations("mobile.budget.write");
	const tc = useTranslations("mobile.common");
	const money = useMoneyText();
	const { api } = useSession();
	const toast = useToast();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const month = data.month.key;
	const currency = data.book.currency;
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const fallbackId = useRef(newClientId());
	const read = useSheetRead(
		visible,
		(client) => client.budget.drafts({ kind: "PLAN", month }),
		String(month),
	);
	const drafts = read.status === "ready" ? read.data : null;
	const base = planBase(drafts);
	const envelope = envelopeById(data, editing);
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered, true);

	useEffect(() => {
		if (!visible) return;
		setEditing(null);
		setDraft("");
		setFailed(false);
		fallbackId.current = newClientId();
	}, [visible]);

	async function save() {
		// The plan is saved whole, so it starts only from a plan read for this
		// month: a save from nothing would replace the open plan with one line.
		if (!api || !drafts || !envelope || minor === null || busy) return;
		const id = drafts?.open?.id ?? fallbackId.current;
		const before = linesOf(base);
		setBusy(true);
		setFailed(false);
		try {
			await api.budget.saveDraft(
				planBody({
					id,
					month,
					lines: linesWith(base, envelope.id, minor, currency),
					base,
				}),
				{ context: { idempotencyKey: newClientId() } },
			);
		} catch {
			setFailed(true);
			setBusy(false);
			// The plan may have changed elsewhere: read it again before a retry.
			read.reload();
			return;
		}
		setBusy(false);
		read.reload();
		toast.show({
			message: t("toast", { name: envelope.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					try {
						await api.budget.saveDraft(
							planBody({ id, month, lines: before, base }),
							{ context: { idempotencyKey: newClientId() } },
						);
						toast.show({ message: tw("undone") });
						read.reload();
					} catch {
						toast.show({ message: tw("undoError") });
					}
				},
			},
		});
		setEditing(null);
		setDraft("");
	}

	const planned = envelope ? plannedFor(base, envelope.id) : null;
	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={envelope ? t("title", { name: envelope.name }) : t("listTitle")}
			visible={visible}
		>
			<SheetBody>
				{envelope ? (
					<>
						<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
							<LinkButton
								label={t("back")}
								onPress={() => {
									setEditing(null);
									setDraft("");
								}}
							/>
						</View>
						<Note>{t("lead")}</Note>
						<Line
							label={t("planned")}
							value={planned ? money(planned) : t("notPlanned")}
						/>
						{envelope.target && envelope.target.need.minor > 0 ? (
							<Note>
								{t("target", { amount: money(envelope.target.need) })}
							</Note>
						) : null}
						<AmountField
							allowZero
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("planned")}
							onDraftChange={setDraft}
						/>
						{failed ? <Note tone="attention">{tw("error")}</Note> : null}
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						<Button
							disabled={!drafts || minor === null || busy}
							label={busy ? tw("saving") : t("save")}
							onPress={() => void save()}
						/>
					</>
				) : (
					<>
						<Note>{t("listLead")}</Note>
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						<ChoiceList
							choices={envelopesOf(data).map((e) => {
								const p = plannedFor(base, e.id);
								return {
									id: e.id,
									label: e.name,
									detail: p ? money(p) : undefined,
								};
							})}
							onPress={setEditing}
							selected={new Set()}
						/>
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}
