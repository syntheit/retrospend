import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMoneyText } from "@/features/read/useMoneyText";
import { isLiability } from "@/features/wealth/accounts";
import type { Account } from "@/features/wealth/source";
import { Sheet } from "@/ui/Sheet";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList, TextField } from "./fields";
import { debtPaymentBody } from "./moreBodies";
import { AmountField, Note, SheetBody, useAmountLocale } from "./parts";
import { type BudgetMonth, envelopesOf } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

const NONE = "none";
const POOL = "pool";

/** Debts and paying accounts in the book currency, open ones only. */
export function splitAccounts(accounts: readonly Account[], currency: string) {
	const open = accounts.filter(
		(a) => a.closedAt === null && a.currency === currency,
	);
	return {
		debts: open.filter((a) => isLiability(a.type)),
		sources: open.filter((a) => !isLiability(a.type)),
	};
}

/**
 * Pay down a debt: the principal leaves the paying envelope (or the pool) and
 * the account you paid from, and the debt's balance falls by it. The dry run
 * shows what the budget does; the toast undoes the payment with everything it
 * wrote.
 */
export function PayDebtSheet({
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
	const t = useTranslations("mobile.budget.payDebt");
	const tp = useTranslations("mobile.budget.pool");
	const { api: client } = useSession();
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const [accounts, setAccounts] = useState<Account[] | null>(null);
	const [debt, setDebt] = useState<string | null>(null);
	const [source, setSource] = useState(NONE);
	const [envelope, setEnvelope] = useState(POOL);
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const { debts, sources } = splitAccounts(accounts ?? [], currency);
	const liabilityId = debt ?? debts[0]?.id ?? null;

	// Read the accounts when the sheet opens; each opening starts empty.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `client` is stable for a session
	useEffect(() => {
		if (!visible || !client) return;
		setDebt(null);
		setSource(NONE);
		setEnvelope(POOL);
		setDraft("");
		setInterestText("");
		let cancelled = false;
		client.accounts
			.list()
			.then((out) => {
				if (!cancelled) setAccounts(out.accounts);
			})
			.catch(() => {
				if (!cancelled) setAccounts([]);
			});
		return () => {
			cancelled = true;
		};
	}, [visible]);

	// Interest in the payment is spending, not balance: asked apart, empty is none.
	const [interestText, setInterestText] = useState("");
	const interestRead = readAmount(interestText, locale, currency);
	const interestMinor = minorOf(interestRead, true);
	const estimate = useSheetRead(
		visible && liabilityId !== null,
		(c) => c.budget.interestEstimate({ liabilityId: liabilityId ?? "" }),
		liabilityId ?? "",
	);
	const expected = estimate.status === "ready" ? estimate.data.interest : null;
	const interestBad = interestRead.state === "invalid";
	const key = `${liabilityId}|${source}|${envelope}|${minor}|${interestMinor}`;
	const { idFor } = useWriteIds(visible ? key : null);
	const body = interestBad
		? null
		: debtPaymentBody({
				id: idFor("payment"),
				liabilityId,
				fromAccountId: source === NONE ? null : source,
				envelopeId: envelope === POOL ? null : envelope,
				minor,
				interestMinor: interestMinor ?? 0,
				currency,
			});
	const flow = useMoneyWrite({
		input: visible ? body : null,
		idempotencyKey: body?.id ?? null,
		preview: (b) =>
			api ? api.budget.previewRecordDebtPayment(b) : noSession(),
		write: (b, k) =>
			api
				? api.budget.recordDebtPayment(b, { context: { idempotencyKey: k } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out || minor === null) return;
		announce({
			message: t("toast", { amount: money({ minor, currency }) }),
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
				{accounts !== null && debts.length === 0 ? (
					<Note>{t("noDebts", { currency })}</Note>
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
						<ChoiceList
							choices={debts.map((a) => ({
								id: a.id,
								label: a.name,
								detail: money(a.balance, { sign: "never" }),
							}))}
							label={t("debt")}
							onPress={setDebt}
							selected={new Set(liabilityId ? [liabilityId] : [])}
						/>
						<AmountField
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("amount")}
							onDraftChange={setDraft}
						/>
						<TextField
							invalid={interestBad}
							keyboardType="decimal-pad"
							label={t("interest")}
							onChangeText={setInterestText}
							value={interestText}
						/>
						<Note>
							{expected
								? `${t("interestEstimate", { amount: money(expected) })} ${t("interestHint")}`
								: t("interestHint")}
						</Note>
						<ChoiceList
							choices={[
								{ id: NONE, label: t("notTracked") },
								...sources.map((a) => ({ id: a.id, label: a.name })),
							]}
							label={t("from")}
							onPress={setSource}
							selected={new Set([source])}
						/>
						<ChoiceList
							choices={[
								{ id: POOL, label: tp(data.toAssign.poolName) },
								...envelopesOf(data).map((e) => ({
									id: e.id,
									label: e.name,
									detail: money(e.left),
								})),
							]}
							label={t("envelope")}
							onPress={setEnvelope}
							selected={new Set([envelope])}
						/>
					</WriteFrame>
				)}
			</SheetBody>
		</Sheet>
	);
}
