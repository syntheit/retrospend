import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { bankFigure, reconcileBody } from "./moreBodies";
import { AmountField, Line, Note, SheetBody, useAmountLocale } from "./parts";
import type { BudgetMonth } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

type BankSide = Awaited<ReturnType<RetrospendClient["budget"]["bankCheck"]>>;

/**
 * Does this match your bank? What the budget holds against the accounts that
 * are part of it. Left empty, the check uses the accounts' own total (the
 * server's figure); typing a number replaces it. A difference is recorded as
 * one Adjustment (To assign moves by it, envelopes keep what they hold); the
 * dry run shows it and the toast removes it.
 */
export function ReconcileSheet({
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
	const t = useTranslations("mobile.budget.reconcile");
	const { api: client } = useSession();
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const [bank, setBank] = useState<BankSide | null>(null);
	const [failed, setFailed] = useState(false);
	const [draft, setDraft] = useState("");
	const currency = bank?.holds.currency ?? data.book.currency;
	const entered = readAmount(draft, locale, currency);
	const minor = bankFigure(entered, bank?.bank.minor ?? null);

	// Read the bank side each time the sheet opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `client` is stable for a session
	useEffect(() => {
		if (!visible || !client) return;
		setBank(null);
		setFailed(false);
		setDraft("");
		let cancelled = false;
		client.budget
			.bankCheck()
			.then((out) => {
				if (!cancelled) setBank(out);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [visible]);

	const { idFor } = useWriteIds(visible ? `${minor}` : null);
	const body = bank
		? reconcileBody({ id: idFor("check"), minor, currency })
		: null;
	const flow = useMoneyWrite({
		input: visible ? body : null,
		idempotencyKey: body?.id ?? null,
		preview: (b) => (api ? api.budget.previewReconcile(b) : noSession()),
		write: (b, key) =>
			api
				? api.budget.reconcile(b, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: out.result.expenseId
				? t("toastRecorded", { amount: money(out.result.amount) })
				: t("toastMatched"),
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
				{failed ? (
					<Note tone="attention">{t("failed")}</Note>
				) : bank === null ? (
					<Note>{t("loading")}</Note>
				) : (
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
						<Note>{t("lead")}</Note>
						{bank.accounts.map((a) => (
							<Line
								key={a.id}
								label={a.name}
								value={money(a.value ?? a.worth)}
							/>
						))}
						<Line label={t("accountsTotal")} value={money(bank.bank)} />
						<Line emphasis label={t("holds")} value={money(bank.holds)} />
						{bank.held.minor !== 0 ? (
							<Line label={t("held")} value={money(bank.held)} />
						) : null}
						{bank.incomplete ? <Note>{t("incomplete")}</Note> : null}
						<AmountField
							allowZero
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("bank")}
							onDraftChange={setDraft}
							placeholder={money(bank.bank, { sign: "never" })}
						/>
					</WriteFrame>
				)}
			</SheetBody>
		</Sheet>
	);
}
