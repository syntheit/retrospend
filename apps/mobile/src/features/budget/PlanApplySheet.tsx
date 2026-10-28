import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { monthDate } from "./months";
import { Line, Note } from "./parts";
import { type BudgetMonth, envelopeById } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteSheet } from "./WriteSheet";

/**
 * Apply the plan for the month on screen: the draft becomes the saved plan
 * that funds itself when that month's money arrives. Nothing moves today; the
 * server previews exactly that and Undo takes the plan back to a draft.
 * Every planned line is listed first.
 */
export function PlanApplySheet({
	data,
	visible,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.planApply");
	const money = useMoneyText();
	const format = useFormatter();
	const month = data.month.key;
	const read = useSheetRead(
		visible,
		(client) => client.budget.drafts({ kind: "PLAN", month }),
		String(month),
	);
	const draft = read.status === "ready" ? read.data.open : null;
	const monthName = format.dateTime(monthDate(month), {
		month: "long",
		timeZone: "UTC",
	});
	const { idFor } = useWriteIds(visible && draft ? draft.id : null);
	return (
		<WriteSheet
			data={data}
			idempotencyKey={draft ? idFor("apply") : null}
			input={draft ? { draftId: draft.id } : null}
			message={t("toast", { month: monthName })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.budget.previewApplyDraft(body)}
			submitLabel={t("apply")}
			title={t("title", { month: monthName })}
			visible={visible}
			write={(api, body, key) =>
				api.budget.applyDraft(body, { context: { idempotencyKey: key } })
			}
		>
			{read.status === "ready" && !draft ? <Note>{t("none")}</Note> : null}
			{draft ? <Note>{t("lead", { month: monthName })}</Note> : null}
			{(draft?.lines ?? [])
				.filter((l) => l.amount.minor > 0)
				.map((l) => (
					<Line
						key={l.envelopeId}
						label={
							envelopeById(data, l.envelopeId)?.name ?? t("envelopeFallback")
						}
						value={money(l.amount)}
					/>
				))}
		</WriteSheet>
	);
}
