import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { glyphOf, isLiability } from "@/features/wealth/accounts";
import { Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { useWriteForm } from "@/features/write/WriteForm";
import { Segmented } from "@/ui/Segmented";
import { Sheet, type SheetDetent, useSheetBodySize } from "@/ui/Sheet";
import {
	MoneyMoveFrame,
	type Place,
	PlaceRows,
	useMoveAmount,
	usePlaces,
} from "./MoneyMoveFrame";
import { POOL } from "./moveEnds";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";
import {
	type CountInput,
	countBody,
	type TransferInput,
	type WealthDirection,
	wealthMoveBody,
} from "./wealthBodies";

/** "Not tracked" stands in the budget accounts by this id. */
const NONE = "none";

/**
 * Move money between an envelope and Wealth, in the transfer's shape (the
 * same as Move money): the amount as the big figure, the two ends as one line
 * ("Groceries → Savings") and the panels From, To, Account and Changes under
 * it, over the keypad that folds into one button. Moving to Wealth: the money
 * leaves an envelope (or Not planned yet) for an account outside the budget.
 * Moving from Wealth: an account outside the budget gives it to an account the
 * budget counts (or Not tracked), and it lands in an envelope. Both are the
 * transfer's own write, so the server previews the accounts, the envelope and
 * Not planned yet before Save, and Undo deletes the move with its budget
 * side. Across currencies the server converts at the reference rate.
 */
export function WealthMoveSheet({
	data,
	direction,
	visible,
	detent = "large",
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	direction: WealthDirection;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations(
		direction === "to" ? "mobile.budget.toWealth" : "mobile.budget.fromWealth",
	);
	const size = useSheetBodySize();
	return (
		<Sheet
			detents={[detent]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			{/* The keypad form runs its own scroll and foot, like the composer. */}
			<View style={size}>
				{visible ? (
					<WealthMoveForm
						data={data}
						direction={direction}
						onClose={onClose}
						onDone={onDone}
					/>
				) : null}
			</View>
		</Sheet>
	);
}

function WealthMoveForm({
	data,
	direction,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	direction: WealthDirection;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations(
		direction === "to" ? "mobile.budget.toWealth" : "mobile.budget.fromWealth",
	);
	const read = useSheetRead(true, (client) => client.accounts.list());
	const accounts = (read.status === "ready" ? read.data.accounts : []).filter(
		(a) => a.closedAt === null && !isLiability(a.type),
	);
	const budgetSide = accounts.filter((a) => a.inBudget);
	const wealthSide = accounts.filter((a) => !a.inBudget);
	const { envelopePlaces, glyphCover, money } = usePlaces(data);

	const [envelope, setEnvelope] = useState(POOL);
	// The Wealth account (the first until one is picked) and the budget
	// account that holds or receives the money (Not tracked until one is picked).
	const [wealthId, setWealthId] = useState<string | null>(null);
	const [budgetId, setBudgetId] = useState(NONE);
	// From Wealth only: the money was moved, or it stays and the budget counts it.
	const [mode, setMode] = useState<"moved" | "count">("moved");
	const counting = direction === "from" && mode === "count";

	const wealth =
		wealthSide.find((a) => a.id === (wealthId ?? wealthSide[0]?.id)) ?? null;
	const budgetAccount = budgetSide.find((a) => a.id === budgetId) ?? null;
	const fromPlace = direction === "to" ? budgetAccount : wealth;
	const intoPlace = direction === "to" ? wealth : budgetAccount;
	const currency = fromPlace?.currency ?? data.book.currency;
	const amount = useMoveAmount(currency, t(counting ? "units" : "amount"));
	const { minor, pad } = amount;

	const { idFor } = useWriteIds(
		JSON.stringify([
			direction,
			envelope,
			fromPlace?.id,
			intoPlace?.id,
			minor,
			mode,
		]),
	);
	const moved = wealthMoveBody({
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
	const counted = countBody({
		id: idFor("count"),
		account: wealth ? { id: wealth.id, currency: wealth.currency } : null,
		envelopeId: envelope === POOL ? null : envelope,
		minor,
	});
	const body: TransferInput | CountInput | null = counting ? counted : moved;
	const envelopeName =
		envelopePlaces.find((p) => p.id === envelope)?.name ?? "";

	const { flow, ready, submit } = useWriteForm({
		input: body,
		idempotencyKey: body?.id ?? null,
		family: counting ? "income" : "transfers",
		preview: (api, b) =>
			"accountId" in b
				? api.income.previewMoveIn(b)
				: api.transfers.previewCreate(b),
		write: async (api, b, key) => {
			const options = { context: { idempotencyKey: key } };
			return "accountId" in b
				? await api.income.moveIn(b, options)
				: await api.transfers.create(b, options);
		},
		message: () => {
			const shown = minor !== null ? money({ minor, currency }) : "";
			return counting
				? t("toastCounted", { name: wealth?.name ?? "" })
				: direction === "to"
					? t("toast", {
							amount: shown,
							name: envelopeName,
							account: wealth?.name ?? "",
						})
					: t("toastMoved", { amount: shown });
		},
		onClose,
		onDone,
	});

	const accountPlace = (a: (typeof accounts)[number]): Place => ({
		id: a.id,
		name: a.name,
		meta: money(a.balance, { sign: "never" }),
		cover: glyphCover(glyphOf(a.type)),
	});
	const wealthPlaces = wealthSide.map(accountPlace);
	const budgetPlaces: Place[] = [
		{
			id: NONE,
			name: t("notTracked"),
			meta: data.book.currency,
			cover: glyphCover("Wallet"),
		},
		...budgetSide.map(accountPlace),
	];

	const rows = (
		label: string,
		places: Place[],
		value: string,
		onPick: (id: string) => void,
	) => (
		<PlaceRows
			label={label}
			onPick={(id) => {
				onPick(id);
				pad.fold();
			}}
			places={places}
			value={value}
		/>
	);
	const tm = useTranslations("mobile.budget.move");
	const from = direction === "to" ? envelopePlaces : wealthPlaces;
	const into = direction === "to" ? wealthPlaces : envelopePlaces;
	const pickEnvelope = (id: string) => setEnvelope(id);
	const fromPick = direction === "to" ? pickEnvelope : setWealthId;
	const intoPick = direction === "to" ? setWealthId : pickEnvelope;
	const fromValue = direction === "to" ? envelope : (wealth?.id ?? "");
	const intoValue = direction === "to" ? (wealth?.id ?? "") : envelope;

	if (read.status === "ready" && wealthSide.length === 0) {
		return <Note>{t(direction === "to" ? "noAccount" : "none")}</Note>;
	}

	const wealthName = wealth?.name ?? "";
	return (
		<MoneyMoveFrame
			add={{ label: t("move"), description: t("move"), folded: t("move") }}
			amount={amount}
			data={data}
			flow={flow}
			header={
				direction === "from" ? (
					<Segmented
						accessibilityLabel={t("mode")}
						onChange={(next) => {
							setMode(next);
							pad.setPage(0);
						}}
						options={[
							{ value: "moved", label: t("moved") },
							{ value: "count", label: t("count") },
						]}
						stretch
						value={mode}
					/>
				) : null
			}
			onSubmit={submit}
			panels={[
				{
					key: "from",
					label: tm("from"),
					icon: "ArrowUpFromLine",
					node: rows(tm("from"), from, fromValue, fromPick),
				},
				{
					key: "to",
					label: tm("to"),
					icon: "ArrowDownToLine",
					node: rows(tm("to"), into, intoValue, intoPick),
				},
				...(counting
					? []
					: [
							{
								key: "account",
								label: t("account"),
								icon: "Landmark" as const,
								node: rows(t("account"), budgetPlaces, budgetId, setBudgetId),
							},
						]),
			]}
			ready={ready}
			summary={[
				{
					key: "ends",
					text: `${direction === "to" ? envelopeName : wealthName} → ${direction === "to" ? wealthName : envelopeName}`,
					active: pad.page <= 1,
					onPress: () => pad.goTo(0),
				},
				...(counting
					? []
					: [
							{
								key: "account",
								text: budgetAccount?.name ?? t("notTracked"),
								active: pad.page === 2,
								onPress: () => pad.goTo(2),
							},
						]),
			]}
		/>
	);
}
