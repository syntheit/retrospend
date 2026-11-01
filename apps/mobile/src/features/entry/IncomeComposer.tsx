import { formatMoneyDraft } from "@retrospend/domain/parse";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import { FieldError, TextField } from "@/ui/TextField";
import { AccountPanel } from "./AccountPanel";
import { AmountBlock } from "./AmountBlock";
import { AmountCard, type MoneyLine } from "./AmountCard";
import { CategoryPanel } from "./CategoryPanel";
import { ComposerFrame } from "./ComposerFrame";
import type { EntryMode } from "./types";
import { ComposerTop } from "./ComposerTop";
import { DEFAULT_RATE } from "./draft";
import { OptionRow } from "./MorePanel";
import { ChangesRow, NoteRow } from "./MoreRows";
import { PlanPanel } from "./PlanPanel";
import { PreviewLine } from "./PreviewLine";
import type { EntryCatalog } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";
import { usePanelFold } from "./usePanelFold";
import { useDayWords, WhenPanel } from "./WhenPanel";

type PanelName = "category" | "when" | "into" | "plan" | "more";
const PANEL_ICON = {
	category: "Tag",
	when: "Calendar",
	into: "ArrowDownToLine",
	plan: "ListChecks",
	more: "Ellipsis",
} as const;

/**
 * Add income on the composer's one screen: the amount (money in), who paid
 * you as the title, the answers as a line, and the panels Category, When,
 * Into (an account, or the budget only), Plan (only with an envelope budget)
 * and More (Note, Repeats). Every answer is written to the income draft the
 * data layer owns, and Add sends what the dry run previewed.
 */
export function IncomeComposer({
	form,
	pv,
	lines,
	rate,
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
	/** The rate line for an amount in another currency; null at home. */
	rate: ReactNode;
	catalog: EntryCatalog;
	onAdd: () => void;
	busy: boolean;
	onCancel: () => void;
	onModeChange: (mode: EntryMode) => void;
	notices: ReactNode;
	surface?: boolean;
}) {
	const t = useTranslations("mobile.composer");
	const locale = useMoneyLocale();
	const { space } = useTheme();
	const day = useDayWords();
	const draft = form.income;
	const { page, goTo, fold, system } = usePanelFold(form);
	const planned = catalog.hasBudget === true;
	const names: PanelName[] = planned
		? ["category", "when", "into", "plan", "more"]
		: ["category", "when", "into", "more"];
	const at = (name: PanelName) => names.indexOf(name);

	const patch = (changes: Partial<typeof draft>) => {
		form.patchIncome(changes);
		fold();
	};
	const incomeCatalog = {
		...catalog,
		categories: catalog.categories.filter((c) => c.kind === "income"),
	};
	const category = incomeCatalog.categories.find(
		(c) => c.id === draft.categoryId,
	);
	const place = catalog.places.find((p) => p.id === draft.into);

	// The summary line: the answers so far, each a way into its panel.
	const extras: string[] = [];
	if (draft.note.trim()) extras.push(t("note"));
	if (draft.repeats) extras.push(t("incomeFlow.repeatsShort"));
	const parts = [
		{
			key: "category",
			text: category?.name ?? t("incomeFlow.noCategory"),
			page: at("category"),
		},
		{ key: "when", text: day.short(draft.date), page: at("when") },
		{
			key: "into",
			text: place
				? t("incomeFlow.intoAccount", { name: place.name })
				: t("incomeFlow.noAccount"),
			page: at("into"),
		},
		...(planned
			? [
					{
						key: "plan",
						text: draft.usePlan ? t("incomeFlow.usesPlan") : t("notPlannedYet"),
						page: at("plan"),
					},
				]
			: []),
		...extras.map((text) => ({ key: `more-${text}`, text, page: at("more") })),
	].map((part) => ({
		key: part.key,
		text: part.text,
		active: page === part.page,
		onPress: () => goTo(part.page),
	}));

	const dots: Record<PanelName, boolean> = {
		category: draft.categoryId !== null,
		when: draft.date !== day.today,
		into: draft.into !== null,
		plan: draft.usePlan !== planned,
		more: extras.length > 0,
	};
	const tabs: PagerTab[] = names.map((name) => ({
		key: name,
		label: t(`tabs.${name}`),
		icon: PANEL_ICON[name],
		dot: dots[name],
	}));

	const panelOf: Record<PanelName, ReactNode> = {
		category: (
			<CategoryPanel
				catalog={incomeCatalog}
				draft={{ categoryId: draft.categoryId, editing: null }}
				error={false}
				key="category"
				onPick={(picked) => patch({ categoryId: picked.id })}
			/>
		),
		when: (
			<WhenPanel
				date={draft.date}
				key="when"
				onPick={(date) => {
					if (date !== draft.date) patch({ date });
				}}
			/>
		),
		into: (
			<AccountPanel
				key="into"
				none={{ name: t("incomeFlow.noAccount"), meta: t("incomeFlow.budgetOnly") }}
				onPick={(picked) =>
					patch(
						picked
							? {
									into: picked.id,
									// An account holds one currency: another one starts the amount over.
									...(picked.currency !== draft.currency
										? {
												currency: picked.currency,
												amountText: "",
												...DEFAULT_RATE,
											}
										: {}),
								}
							: { into: null },
					)
				}
				places={catalog.places}
				value={draft.into}
			/>
		),
		plan: (
			<PlanPanel
				key="plan"
				onChange={(usePlan) => patch({ usePlan })}
				plan={pv.plan}
				usePlan={draft.usePlan}
			/>
		),
		more: (
			<View key="more" style={{ gap: space[2] }}>
				<NoteRow
					onChange={(note) => form.patchIncome({ note })}
					onPicked={fold}
					onTypingChange={form.setTyping}
					value={draft.note}
				/>
				<OptionRow
					icon="Repeat"
					name={t("incomeFlow.repeats")}
					on={draft.repeats}
					onPress={() => patch({ repeats: !draft.repeats })}
					state={draft.repeats ? t("extras.remove") : t("extras.add")}
				/>
				<ChangesRow preview={pv} />
			</View>
		),
	};

	const money = lines[0] as MoneyLine;
	const amount = system ? (
		<AmountCard
			foreign={rate}
			lines={lines}
			ring={form.tried && form.amountProblem === true ? "error" : "idle"}
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
		<AmountBlock
			below={rate}
			error={form.tried && form.amountProblem === true}
			folded={!form.padOpen || form.typing}
			line={money}
			onPress={() => form.requestKeypad()}
		/>
	);

	const sourceError = form.tried && form.incomeProblems.source === true;
	return (
		<ComposerFrame
			add={{
				onPress: onAdd,
				label: t("add"),
				description: t("addIncome"),
				folded: t("addIncome"),
				off: pv.blocked || form.typedAmount === null,
				busy,
			}}
			amount={amount}
			changedLabel={t("tabs.changed")}
			header={
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
			}
			keypad={{
				text: form.keypad.text,
				currency: form.keypad.currency,
				kind: "money",
				onChange: form.patchAmount,
			}}
			keypadOpen={form.padOpen}
			onPageChange={(next) => goTo(next)}
			onScrollDrag={() => {
				if (system) form.setPadOpen(false);
			}}
			page={page}
			panels={names.map((name) => panelOf[name])}
			preview={<PreviewLine state={pv.preview} />}
			summary={parts}
			surface={surface}
			tabs={tabs}
			tabsLabel={t("tabs.label")}
			title={
				<View>
					<TextField
						align="center"
						autoCapitalize="sentences"
						bare
						hideLabel
						invalid={sourceError}
						label={t("from")}
						onChangeText={(source) => form.patchIncome({ source })}
						onTypingChange={form.setTyping}
						placeholder={t("fromPlaceholder")}
						value={draft.source}
					/>
					{sourceError ? (
						<View style={{ alignItems: "center" }}>
							<FieldError>{t("errors.source")}</FieldError>
						</View>
					) : null}
				</View>
			}
			typing={form.typing}
		/>
	);
}
