import { useFormatter, useTranslations } from "use-intl";
import { nextMonthKey, planBase } from "./draftsBody";
import { monthDate } from "./months";
import { Note } from "./parts";
import type { BudgetMonth } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteSheet } from "./WriteSheet";

/**
 * Fund next month now: a saved plan is a draft until payday. This is the
 * separate, previewed step that takes next month's plan out of what this
 * month has not planned yet. The server lists every envelope it fills before
 * Save, and Undo puts it back.
 */
export function FundNowSheet({
	data,
	next,
	visible,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	/** True when the month on screen is already the coming one. */
	next: boolean;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.fundNow");
	const format = useFormatter();
	const target = next ? data.month.key : nextMonthKey(data.month.key);
	const read = useSheetRead(
		visible,
		(client) => client.budget.drafts({ kind: "PLAN", month: target }),
		String(target),
	);
	const draft = planBase(read.status === "ready" ? read.data : null);
	const nextName = format.dateTime(monthDate(target), {
		month: "long",
		timeZone: "UTC",
	});
	const { idFor } = useWriteIds(visible && draft ? draft.id : null);
	const batchId = draft ? idFor("fund") : null;
	return (
		<WriteSheet
			data={data}
			idempotencyKey={batchId}
			input={draft && batchId ? { draftId: draft.id, batchId } : null}
			message={t("toast", { next: nextName })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.budget.previewFundPlanNow(body)}
			submitLabel={t("fund", { next: nextName })}
			title={t("title", { next: nextName })}
			visible={visible}
			write={(api, body, key) =>
				api.budget.fundPlanNow(body, { context: { idempotencyKey: key } })
			}
		>
			{read.status === "ready" && !draft ? <Note>{t("noPlan")}</Note> : null}
			{draft ? <Note>{t("lead", { next: nextName })}</Note> : null}
		</WriteSheet>
	);
}
