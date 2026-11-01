import { categoryTone } from "@retrospend/domain/category-tone";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { AmountEntry } from "@/features/entry/AmountEntry";
import { ComposerFrame } from "@/features/entry/ComposerFrame";
import { useMoneyText } from "@/features/read/useMoneyText";
import { glyphOf, isLiability } from "@/features/wealth/accounts";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useAmountLine } from "@/features/write/useAmountLine";
import { useFoldingPad } from "@/features/write/useFoldingPad";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import { CategoryGlyph, categoryColor, Glyph } from "@/ui/Glyph";
import { ProjectRow } from "@/ui/ProjectRow";
import { Segmented } from "@/ui/Segmented";
import { type SheetDetent, Sheet, useSheetBodySize } from "@/ui/Sheet";
import { BudgetChanges, BudgetPreviewLine } from "./BudgetChanges";
import { type BudgetMonth, envelopesOf } from "./source";
import { useSheetRead } from "./useSheetRead";
import {
	type CountInput,
	countBody,
	type TransferInput,
	type WealthDirection,
	wealthMoveBody,
} from "./wealthBodies";

/** The pool ("Not planned yet") stands in the envelopes by this id. */
const POOL = "pool";
/** "Not tracked" stands in the budget accounts by this id. */
const NONE = "none";

const ICON = {
	from: "ArrowUpFromLine",
	to: "ArrowDownToLine",
	account: "Landmark",
	changes: "ListChecks",
} as const;
type PanelName = keyof typeof ICON;

/** One choice in a panel: an envelope, the pool, or an account. */
interface Place {
	id: string;
	name: string;
	/** Already worded: "$80 left" or the account's balance. */
	meta: string;
	cover: ReactNode;
}

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
	const tm = useTranslations("mobile.budget.move");
	const tp = useTranslations("mobile.budget.pool");
	const tb = useTranslations("mobile.budget");
	const tc = useTranslations("mobile.composer");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const api = useApi();
	const { color, radius, size, space } = useTheme();
	const read = useSheetRead(true, (client) => client.accounts.list());
	const accounts = (read.status === "ready" ? read.data.accounts : []).filter(
		(a) => a.closedAt === null && !isLiability(a.type),
	);
	const budgetSide = accounts.filter((a) => a.inBudget);
	const wealthSide = accounts.filter((a) => !a.inBudget);

	const [envelope, setEnvelope] = useState(POOL);
	// The Wealth account (the first until one is picked) and the budget
	// account that holds or receives the money (Not tracked until one is picked).
	const [wealthId, setWealthId] = useState<string | null>(null);
	const [budgetId, setBudgetId] = useState(NONE);
	const [draft, setDraft] = useState("");
	const [page, setPage] = useState(0);
	// From Wealth only: the money was moved, or it stays and the budget counts it.
	const [mode, setMode] = useState<"moved" | "count">("moved");
	const counting = direction === "from" && mode === "count";
	const announce = useUndoToast(counting ? "income" : "transfers");

	const wealth =
		wealthSide.find((a) => a.id === (wealthId ?? wealthSide[0]?.id)) ?? null;
	const budgetAccount = budgetSide.find((a) => a.id === budgetId) ?? null;
	const fromPlace = direction === "to" ? budgetAccount : wealth;
	const intoPlace = direction === "to" ? wealth : budgetAccount;
	const currency = fromPlace?.currency ?? data.book.currency;
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const pad = useFoldingPad(minor !== null);
	const line = useAmountLine({
		currency,
		text: draft,
		entered,
		label: t(counting ? "units" : "amount"),
		onPress: () => pad.setPadOpen(true),
	});

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

	const flow = useMoneyWrite({
		input: body,
		idempotencyKey: body?.id ?? null,
		preview: (b) =>
			api
				? "accountId" in b
					? api.income.previewMoveIn(b)
					: api.transfers.previewCreate(b)
				: noSession(),
		write: async (b, key) => {
			if (!api) return noSession();
			const options = { context: { idempotencyKey: key } };
			return "accountId" in b
				? await api.income.moveIn(b, options)
				: await api.transfers.create(b, options);
		},
	});
	const ready = flow.status === "ready";

	const envelopes = envelopesOf(data);
	const poolName = tp(data.toAssign.poolName);
	const envelopeName =
		envelope === POOL
			? poolName
			: (envelopes.find((e) => e.id === envelope)?.name ?? "");

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		const amount = minor !== null ? money({ minor, currency }) : "";
		announce({
			message: counting
				? t("toastCounted", { name: wealth?.name ?? "" })
				: direction === "to"
					? t("toast", {
							amount,
							name: envelopeName,
							account: wealth?.name ?? "",
						})
					: t("toastMoved", { amount }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const cover = (inner: ReactNode) => (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size.avatar.md,
				height: size.avatar.md,
				borderRadius: radius.ctl,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: color.raised,
			}}
		>
			{inner}
		</View>
	);
	const envelopePlaces: Place[] = [
		{
			id: POOL,
			name: poolName,
			meta: tb("row.leftSpoken", { amount: money(data.toAssign.amount) }),
			cover: cover(
				<Glyph color={color.fg2} name="Coins" size={size.icon.phone} />,
			),
		},
		...envelopes.map((e) => ({
			id: e.id,
			name: e.name,
			meta: tb("row.leftSpoken", { amount: money(e.left) }),
			cover: cover(
				<CategoryGlyph
					category={{ name: e.name, icon: e.icon }}
					color={categoryColor(color, categoryTone(e.color ?? ""))}
					size={size.icon.phone}
				/>,
			),
		})),
	];
	const accountPlace = (a: (typeof accounts)[number]): Place => ({
		id: a.id,
		name: a.name,
		meta: money(a.balance, { sign: "never" }),
		cover: cover(
			<Glyph color={color.fg2} name={glyphOf(a.type)} size={size.icon.phone} />,
		),
	});
	const wealthPlaces = wealthSide.map(accountPlace);
	const budgetPlaces: Place[] = [
		{
			id: NONE,
			name: t("notTracked"),
			meta: data.book.currency,
			cover: cover(
				<Glyph color={color.fg2} name="Wallet" size={size.icon.phone} />,
			),
		},
		...budgetSide.map(accountPlace),
	];

	const rowsOf = (
		label: string,
		places: Place[],
		value: string,
		onPick: (id: string) => void,
	): ReactNode => (
		<View accessibilityLabel={label} style={{ gap: space[2] }}>
			{places.map((place) => (
				<ProjectRow
					cover={place.cover}
					faces={[]}
					key={place.id}
					meta={place.meta}
					name={place.name}
					onPress={() => {
						onPick(place.id);
						pad.fold();
					}}
					selected={value === place.id}
				/>
			))}
		</View>
	);

	const names: PanelName[] = counting
		? ["from", "to", "changes"]
		: ["from", "to", "account", "changes"];
	const labels: Record<PanelName, string> = {
		from: tm("from"),
		to: tm("to"),
		account: t("account"),
		changes: tm("changes"),
	};
	const tabs: PagerTab[] = names.map((name) => ({
		key: name,
		label: labels[name],
		icon: ICON[name],
	}));
	const pickWealth = (id: string) => setWealthId(id);
	const pickEnvelope = (id: string) => setEnvelope(id);
	const fromPanel =
		direction === "to"
			? rowsOf(labels.from, envelopePlaces, envelope, pickEnvelope)
			: rowsOf(labels.from, wealthPlaces, wealth?.id ?? "", pickWealth);
	const toPanel =
		direction === "to"
			? rowsOf(labels.to, wealthPlaces, wealth?.id ?? "", pickWealth)
			: rowsOf(labels.to, envelopePlaces, envelope, pickEnvelope);
	const panelOf: Record<PanelName, ReactNode> = {
		from: fromPanel,
		to: toPanel,
		account: rowsOf(labels.account, budgetPlaces, budgetId, setBudgetId),
		changes: (
			<View style={{ gap: space[2] }}>
				<BudgetChanges
					data={data}
					preview={flow.preview}
					status={flow.status}
				/>
				{flow.commitFailed ? (
					<Note tone="attention">{tb("write.error")}</Note>
				) : null}
			</View>
		),
	};
	const panels = names.map((name) => <View key={name}>{panelOf[name]}</View>);

	const goTo = (next: number) => {
		setPage(next);
		pad.fold();
	};
	const wealthName = wealth?.name ?? "";
	const fromName = direction === "to" ? envelopeName : wealthName;
	const toName = direction === "to" ? wealthName : envelopeName;
	const summary = [
		{
			key: "ends",
			text: `${fromName} → ${toName}`,
			active: page <= 1,
			onPress: () => goTo(0),
		},
		...(counting
			? []
			: [
					{
						key: "account",
						text: budgetAccount?.name ?? t("notTracked"),
						active: page === 2,
						onPress: () => goTo(2),
					},
				]),
	];

	if (read.status === "ready" && wealthSide.length === 0) {
		return <Note>{t(direction === "to" ? "noAccount" : "none")}</Note>;
	}

	return (
		<ComposerFrame
			add={{
				onPress: submit,
				label: t("move"),
				description: t("move"),
				folded: t("move"),
				off: !ready,
				busy: flow.committing,
			}}
			amount={
				<AmountEntry
					below={
						<BudgetPreviewLine
							data={data}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					currency={currency}
					error={entered.state === "invalid"}
					line={line}
					onFocusChange={pad.setTyping}
					onPress={() => pad.setPadOpen(true)}
					onText={setDraft}
					padOpen={pad.padOpen}
					system={pad.system}
					text={draft}
					typing={pad.typing}
				/>
			}
			changedLabel={tc("tabs.changed")}
			header={
				direction === "from" ? (
					<Segmented
						accessibilityLabel={t("mode")}
						onChange={(next) => {
							setMode(next);
							setPage(0);
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
			keypad={{
				text: draft,
				currency,
				kind: "money",
				onChange: setDraft,
			}}
			keypadOpen={pad.padOpen}
			onPageChange={(next) => goTo(next)}
			onScrollDrag={() => {
				if (pad.system) pad.setPadOpen(false);
			}}
			page={page}
			panels={panels}
			preview={null}
			summary={summary}
			surface
			tabs={tabs}
			tabsLabel={tc("tabs.label")}
			title={null}
			typing={pad.typing}
		/>
	);
}
