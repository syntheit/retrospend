import { formatMoneyDraft } from "@retrospend/domain/parse";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import { FieldError, TextField } from "@/ui/TextField";
import { AccountPanel } from "./AccountPanel";
import { AmountCard, type MoneyLine } from "./AmountCard";
import type { ComposerFrameProps } from "./ComposerFrame";
import { ComposerTop } from "./ComposerTop";
import { OptionRow } from "./MorePanel";
import { ChangesRow, NoteRow } from "./MoreRows";
import { PreviewLine } from "./PreviewLine";
import { TransferAmount } from "./TransferAmount";
import type { EntryCatalog, EntryMode } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";
import { usePanelFold } from "./usePanelFold";
import { useDayWords, WhenPanel } from "./WhenPanel";

const PANELS = ["from", "to", "when", "more"] as const;
type PanelName = (typeof PANELS)[number];
const PANEL_ICON = {
	from: "ArrowUpFromLine",
	to: "ArrowDownToLine",
	when: "Calendar",
	more: "Ellipsis",
} as const;

/**
 * Add transfer on the composer's one screen: the amount as "You send" and,
 * between two currencies, "You receive", the accounts as a line, and the
 * panels From, To, When and More (Note, Bank fee). Tapping either amount row
 * brings the keypad back on that figure.
 */
export function useTransferFrame({
	active,
	form,
	pv,
	lines,
	catalog,
	onAdd,
	busy,
	onCancel,
	onModeChange,
	notices,
	surface,
}: {
	form: EntryForm;
	pv: ComposerPreview;
	lines: MoneyLine[];
	catalog: EntryCatalog;
	onAdd: () => void;
	busy: boolean;
	onCancel: () => void;
	onModeChange: (mode: EntryMode) => void;
	notices: ReactNode;
	surface?: boolean;
	/** This mode is on screen: only then do its side effects run. */
	active: boolean;
}): ComposerFrameProps {
	const t = useTranslations("mobile.composer");
	const tt = useTranslations("mobile.composer.transfer");
	const locale = useMoneyLocale();
	const { space } = useTheme();
	const day = useDayWords();
	const draft = form.transfer;
	const { page, goTo, fold, system } = usePanelFold(form);
	const from = catalog.places.find((p) => p.id === draft.fromId);
	const to = catalog.places.find((p) => p.id === draft.toId);
	const problems = form.tried ? form.transferProblems : {};

	const patch = (changes: Partial<typeof draft>) => {
		form.patchTransfer(changes);
		fold();
	};

	const fee = draft.feeText.trim();
	const [feeAsked, setFeeAsked] = useState(false);
	const feeOpen = feeAsked || fee.length > 0;
	const extras: string[] = [];
	if (draft.note.trim()) extras.push(t("note"));
	if (fee) extras.push(tt("fee"));
	const parts = [
		{
			key: "accounts",
			text: from && to ? `${from.name} → ${to.name}` : tt("errors.places"),
			tone: from && to ? undefined : ("attention" as const),
			page: 0,
		},
		{ key: "when", text: day.short(draft.date), page: 2 },
		...extras.map((text) => ({
			key: `more-${text}`,
			text,
			tone: undefined,
			page: 3,
		})),
	].map((part) => ({
		key: part.key,
		text: part.text,
		tone: part.tone,
		active: page === part.page,
		onPress: () => goTo(part.page),
	}));

	const dots: Record<PanelName, boolean> = {
		from: false,
		to: false,
		when: draft.date !== day.today,
		more: extras.length > 0,
	};
	const tabLabels: Record<PanelName, string> = {
		from: tt("from"),
		to: tt("to"),
		when: t("tabs.when"),
		more: t("tabs.more"),
	};
	const tabs: PagerTab[] = PANELS.map((name) => ({
		key: name,
		label: tabLabels[name],
		icon: PANEL_ICON[name],
		dot: dots[name],
	}));

	const panels = [
		<AccountPanel
			error={
				problems.same
					? tt("errors.same")
					: problems.places
						? tt("errors.places")
						: undefined
			}
			key="from"
			onPick={(picked) => {
				if (!picked) return;
				// A new currency makes the typed digits meaningless.
				patch({
					fromId: picked.id,
					receivedText: "",
					...(picked.currency !== from?.currency ? { amountText: "" } : {}),
				});
			}}
			places={catalog.places.filter((p) => p.id !== draft.toId)}
			value={draft.fromId}
		/>,
		<AccountPanel
			error={problems.same ? tt("errors.same") : undefined}
			key="to"
			onPick={(picked) => {
				if (picked) patch({ toId: picked.id, receivedText: "" });
			}}
			places={catalog.places.filter((p) => p.id !== draft.fromId)}
			value={draft.toId}
		/>,
		<WhenPanel
			date={draft.date}
			key="when"
			onPick={(date) => {
				if (date !== draft.date) patch({ date });
			}}
		/>,
		<View key="more" style={{ gap: space[2] }}>
			<NoteRow
				onChange={(note) => form.patchTransfer({ note })}
				onPicked={fold}
				onTypingChange={form.setTyping}
				value={draft.note}
			/>
			<OptionRow
				icon="Receipt"
				name={tt("fee")}
				on={feeOpen}
				onPress={() => {
					if (feeOpen) form.patchTransfer({ feeText: "" });
					setFeeAsked(!feeOpen);
					fold();
				}}
				state={feeOpen ? t("extras.remove") : t("extras.add")}
			>
				{feeOpen ? (
					<>
						<TextField
							hideLabel
							invalid={problems.fee}
							keyboardType="decimal-pad"
							label={tt("fee")}
							onChangeText={(raw) =>
								form.patchTransfer({
									feeText: formatMoneyDraft(
										raw,
										locale,
										form.fromCurrency,
										draft.feeText,
									),
								})
							}
							onTypingChange={form.setTyping}
							placeholder={form.fromCurrency}
							value={draft.feeText}
						/>
						{problems.fee ? <FieldError>{tt("errors.fee")}</FieldError> : null}
					</>
				) : null}
			</OptionRow>
			<ChangesRow preview={pv} />
		</View>,
	];

	const rows = [
		{
			line: lines[0] as MoneyLine,
			title: tt("send"),
			account: from?.name ?? "",
		},
		...(lines[1]
			? [{ line: lines[1], title: tt("receive"), account: to?.name ?? "" }]
			: []),
	];
	const amountError = form.tried && form.amountProblem === true;
	const amount = (
		<View style={{ gap: space[1] }}>
			{system ? (
				<AmountCard
					lines={lines}
					ring={amountError ? "error" : "idle"}
					system={{
						autoFocus: form.padOpen,
						onChangeText: (raw) =>
							form.patchAmount(
								formatMoneyDraft(
									raw,
									locale,
									form.keypad.currency,
									form.keypad.text,
								),
							),
						onFocusChange: form.setTyping,
					}}
				/>
			) : (
				<TransferAmount
					error={amountError}
					keysUp={form.padOpen && !form.typing}
					rows={rows}
				/>
			)}
			{problems.received ? (
				<FieldError>{tt("errors.received")}</FieldError>
			) : null}
		</View>
	);

	return {
		add: {
			onPress: onAdd,
			label: t("add"),
			description: t("addTransfer"),
			folded: t("addTransfer"),
			off: pv.blocked || form.typedAmount === null,
			busy,
		},
		amount: amount,
		changedLabel: t("tabs.changed"),
		header: (
			<View style={{ gap: space[2] }}>
				<ComposerTop
					actions={[]}
					editing={false}
					mode={form.mode}
					modes={form.modes}
					onCancel={onCancel}
					onModeChange={onModeChange}
				/>
				{notices}
			</View>
		),
		keypad: {
			text: form.keypad.text,
			currency: form.keypad.currency,
			kind: "money" as const,
			onChange: form.patchAmount,
		},
		keypadOpen: form.padOpen,
		mode: "transfer" as const,
		onPageChange: (next: number) => goTo(next),
		onScrollDrag: () => {
			if (system) form.setPadOpen(false);
		},
		page: page,
		panels: panels,
		preview: <PreviewLine state={pv.preview} />,
		summary: parts,
		surface: surface,
		tabs: tabs,
		tabsLabel: t("tabs.label"),
		title: null,
		typing: form.typing,
	};
}
