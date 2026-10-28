import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { isLiability } from "@/features/wealth/accounts";
import { minorOf, readAmount } from "./amount";
import { ChoiceList } from "./fields";
import { AmountField, Note, useAmountLocale } from "./parts";
import { type BudgetMonth, envelopesOf } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteSheet } from "./WriteSheet";
import { type WealthDirection, wealthMoveBody } from "./wealthBodies";

const NONE = "none";
const POOL = "pool";

/**
 * Move money between an envelope and Wealth. Moving to Wealth: it leaves an
 * envelope (or Not planned yet) for an account outside the budget. Moving
 * from Wealth: an account outside the budget gives it to an account the
 * budget counts (or Not tracked), and it lands in an envelope. Both are the
 * transfer's own write, so the server previews the accounts, the envelope and
 * Not planned yet before Save, and Undo deletes the move with its budget
 * side. Across currencies the server converts at the reference rate.
 */
export function WealthMoveSheet({
	data,
	direction,
	visible,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	direction: WealthDirection;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations(
		direction === "to" ? "mobile.budget.toWealth" : "mobile.budget.fromWealth",
	);
	const tp = useTranslations("mobile.budget.pool");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const read = useSheetRead(visible, (client) => client.accounts.list());
	const accounts = (read.status === "ready" ? read.data.accounts : []).filter(
		(a) => a.closedAt === null && !isLiability(a.type),
	);
	const budgetSide = accounts.filter((a) => a.inBudget);
	const wealthSide = accounts.filter((a) => !a.inBudget);
	const [envelope, setEnvelope] = useState(POOL);
	const [source, setSource] = useState<string | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	// Each opening starts empty.
	useEffect(() => {
		if (!visible) return;
		setEnvelope(POOL);
		setSource(null);
		setTarget(null);
		setDraft("");
	}, [visible]);

	const find = (list: typeof accounts, id: string | null) =>
		list.find((a) => a.id === id) ?? null;
	// To Wealth: the money leaves a budget account (or Not tracked) for a Wealth one.
	// From Wealth: a Wealth account gives it to a budget account (or Not tracked).
	const fromList = direction === "to" ? budgetSide : wealthSide;
	const intoList = direction === "to" ? wealthSide : budgetSide;
	const fromPlace =
		direction === "to"
			? source === null || source === NONE
				? null
				: find(fromList, source)
			: find(fromList, source ?? fromList[0]?.id ?? null);
	const intoPlace =
		direction === "from"
			? target === null || target === NONE
				? null
				: find(intoList, target)
			: find(intoList, target ?? intoList[0]?.id ?? null);
	const currency = fromPlace?.currency ?? data.book.currency;
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const { idFor } = useWriteIds(
		visible
			? JSON.stringify([
					direction,
					envelope,
					fromPlace?.id,
					intoPlace?.id,
					minor,
				])
			: null,
	);
	const body = wealthMoveBody({
		id: idFor("move"),
		direction,
		fromPlace: fromPlace
			? { id: fromPlace.id, currency: fromPlace.currency }
			: null,
		intoPlace: intoPlace
			? { id: intoPlace.id, currency: intoPlace.currency }
			: null,
		envelopeId: envelope === POOL ? null : envelope,
		minor,
		bookCurrency: data.book.currency,
	});
	const place = (a: (typeof accounts)[number]) => ({
		id: a.id,
		label: a.name,
		detail: money(a.balance, { sign: "never" }),
	});
	const wealthEmpty = read.status === "ready" && wealthSide.length === 0;
	const envelopeName =
		envelope === POOL
			? tp(data.toAssign.poolName)
			: (envelopesOf(data).find((e) => e.id === envelope)?.name ?? "");

	return (
		<WriteSheet
			data={data}
			family="transfers"
			idempotencyKey={body?.id ?? null}
			input={body}
			message={
				direction === "to"
					? t("toast", {
							amount: minor !== null ? money({ minor, currency }) : "",
							name: envelopeName,
							account: intoPlace?.name ?? "",
						})
					: t("toastMoved", {
							amount: minor !== null ? money({ minor, currency }) : "",
						})
			}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.transfers.previewCreate(b)}
			submitLabel={t("move")}
			title={t("title", { name: envelopeName })}
			visible={visible}
			write={(api, b, key) =>
				api.transfers.create(b, { context: { idempotencyKey: key } })
			}
		>
			{wealthEmpty ? (
				<Note>{t(direction === "to" ? "noAccount" : "none")}</Note>
			) : (
				<>
					<Note>{t("lead", { name: envelopeName })}</Note>
					<ChoiceList
						choices={[
							{ id: POOL, label: tp(data.toAssign.poolName) },
							...envelopesOf(data).map((e) => ({
								id: e.id,
								label: e.name,
								detail: money(e.left),
							})),
						]}
						label={t(direction === "to" ? "envelope" : "putIn")}
						onPress={setEnvelope}
						selected={new Set([envelope])}
					/>
					<ChoiceList
						choices={[
							...(direction === "to"
								? [{ id: NONE, label: t("notTracked") }]
								: []),
							...fromList.map(place),
						]}
						label={t("from")}
						onPress={setSource}
						selected={
							new Set([
								direction === "to"
									? (source ?? NONE)
									: (fromPlace?.id ?? fromList[0]?.id ?? ""),
							])
						}
					/>
					<ChoiceList
						choices={[
							...(direction === "from"
								? [{ id: NONE, label: t("notTracked") }]
								: []),
							...intoList.map(place),
						]}
						label={t("into")}
						onPress={setTarget}
						selected={
							new Set([
								direction === "from"
									? (target ?? NONE)
									: (intoPlace?.id ?? intoList[0]?.id ?? ""),
							])
						}
					/>
					<AmountField
						currency={currency}
						draft={draft}
						entered={entered}
						label={t("amount")}
						onDraftChange={setDraft}
					/>
				</>
			)}
		</WriteSheet>
	);
}
