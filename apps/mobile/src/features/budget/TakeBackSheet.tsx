import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { SheetDetent } from "@/ui/Sheet";
import { takeBackBody } from "./bodies";
import type { BudgetMonth } from "./source";
import { FormSheet, WriteForm } from "./WriteSheet";

/**
 * Take it back: more was planned than there is, so the pool is negative. The
 * server takes the shortfall back from the envelopes that hold money
 * (Spending first, then Savings; bills stay) as one batch. The dry run lists
 * every envelope it touches, and the toast undoes it.
 */
export function TakeBackSheet({
	data,
	visible,
	detent = "large",
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.takeBack");
	const money = useMoneyText();
	// How much more was planned than there is: the server's figure.
	const owed = data.verdict.plannedTooMuch;
	const needed = owed.minor > 0;
	const { idFor, reset } = useWriteIds(needed ? "take-back" : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening is a new write
	useEffect(() => {
		if (visible) reset();
	}, [visible]);
	const input = needed ? takeBackBody(idFor("batch")) : null;

	return (
		<FormSheet
			detent={detent}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			{needed ? (
				<WriteForm
					active={visible}
					data={data}
					idempotencyKey={input?.batchId ?? null}
					input={input}
					message={() => t("toast", { amount: money(owed, { sign: "never" }) })}
					onClose={onClose}
					onDone={onDone}
					preview={(api, body) => api.budget.previewFixNegative(body)}
					submitLabel={t("submit")}
					write={(api, body, key) =>
						api.budget.fixNegative(body, { context: { idempotencyKey: key } })
					}
				>
					<Note>{t("lead", { amount: money(owed, { sign: "never" }) })}</Note>
				</WriteForm>
			) : (
				<Note>{t("nothing")}</Note>
			)}
		</FormSheet>
	);
}
