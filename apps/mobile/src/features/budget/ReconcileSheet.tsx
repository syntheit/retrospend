import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMoneyText } from "@/features/read/useMoneyText";
import { readAmount } from "@/features/write/amount";
import {
	AmountField,
	Line,
	Note,
	useAmountLocale,
} from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { EmptyState } from "@/ui/EmptyState";
import type { SheetDetent } from "@/ui/Sheet";
import { SkeletonRows } from "@/ui/Skeleton";
import { bankFigure, reconcileBody } from "./moreBodies";
import type { BudgetMonth } from "./source";
import { FormSheet, WriteForm } from "./WriteSheet";

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
	const t = useTranslations("mobile.budget.reconcile");
	const tc = useTranslations("mobile.common");
	const { api: client } = useSession();
	const money = useMoneyText();
	const locale = useAmountLocale();
	const [bank, setBank] = useState<BankSide | null>(null);
	const [failed, setFailed] = useState(false);
	const [again, setAgain] = useState(0);
	const [draft, setDraft] = useState("");
	const currency = bank?.holds.currency ?? data.book.currency;
	const entered = readAmount(draft, locale, currency);
	const minor = bankFigure(entered, bank?.bank.minor ?? null);

	// Read the bank side each time the sheet opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `client` is stable for a session; `again` is Retry
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
	}, [visible, again]);

	const { idFor } = useWriteIds(visible ? `${minor}` : null);
	const body = bank
		? reconcileBody({ id: idFor("check"), minor, currency })
		: null;
	return (
		<FormSheet
			detent={detent}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			{failed ? (
				<EmptyState
					actionLabel={tc("retry")}
					onAction={() => setAgain((n) => n + 1)}
					title={t("failed")}
				/>
			) : bank === null ? (
				<SkeletonRows count={2} />
			) : (
				<WriteForm
					active={visible}
					data={data}
					idempotencyKey={body?.id ?? null}
					input={body}
					message={(
						out: Awaited<ReturnType<RetrospendClient["budget"]["reconcile"]>>,
					) =>
						out.result.expenseId
							? t("toastRecorded", { amount: money(out.result.amount) })
							: t("toastMatched")
					}
					onClose={onClose}
					onDone={onDone}
					preview={(api, b) => api.budget.previewReconcile(b)}
					submitLabel={t("submit")}
					write={(api, b, key) =>
						api.budget.reconcile(b, { context: { idempotencyKey: key } })
					}
				>
					<Note>{t("lead")}</Note>
					{bank.accounts.map((a) => (
						<Line key={a.id} label={a.name} value={money(a.value ?? a.worth)} />
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
				</WriteForm>
			)}
		</FormSheet>
	);
}
