import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { BudgetChanges } from "./BudgetChanges";
import { takeBackBody } from "./bodies";
import { Note, SheetBody } from "./parts";
import type { BudgetMonth } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

/**
 * Take it back: more was planned than there is, so the pool is negative. The
 * server takes the shortfall back from the envelopes that hold money
 * (Spending first, then Savings; bills stay) as one batch. The dry run lists
 * every envelope it touches, and the toast undoes it.
 */
export function TakeBackSheet({
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
	const t = useTranslations("mobile.budget.takeBack");
	const api = useApi();
	const announce = useUndoToast("budget");
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

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: input?.batchId ?? null,
		preview: (body) =>
			api ? api.budget.previewFixNegative(body) : noSession(),
		write: (body, key) =>
			api
				? api.budget.fixNegative(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { amount: money(owed, { sign: "never" }) }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				{needed ? (
					<WriteFrame
						busy={flow.committing}
						changes={
							<BudgetChanges
								data={data}
								preview={flow.preview}
								status={flow.status}
							/>
						}
						failed={flow.commitFailed}
						onSubmit={submit}
						ready={flow.status === "ready"}
						submitLabel={t("submit")}
					>
						<Note>{t("lead", { amount: money(owed, { sign: "never" }) })}</Note>
					</WriteFrame>
				) : (
					<Note>{t("nothing")}</Note>
				)}
			</SheetBody>
		</Sheet>
	);
}
