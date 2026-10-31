import { formatMoneyDraft } from "@retrospend/domain/parse";
import { type ReactNode, useCallback, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import type { PagerTab } from "@/ui/DetailPager";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import type { MenuItem } from "@/ui/types";
import { AmountBlock } from "./AmountBlock";
import { AmountCard, type MoneyLine } from "./AmountCard";
import { CategoryPanel } from "./CategoryPanel";
import { ComposerFrame, SYSTEM_PAD_SCALE } from "./ComposerFrame";
import type { EntryMode } from "./ComposerShell";
import { ComposerTop } from "./ComposerTop";
import { type ExpenseDraft, isPersonal, pickCategory } from "./draft";
import { MorePanel } from "./MorePanel";
import { PreviewLine } from "./PreviewLine";
import { ProjectPanel } from "./ProjectPanel";
import { SyncIssues } from "./SyncIssues";
import { useTitleMemory } from "./titleMemory";
import type { EntryCatalog, EntryCategory } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";
import type { SplitView } from "./useSplitView";
import { useDayWords, WhenPanel } from "./WhenPanel";
import { WhoPanel } from "./WhoPanel";

/** The five panels, in the order of the tabs. */
const PANELS = ["category", "when", "who", "project", "more"] as const;
type PanelName = (typeof PANELS)[number];
const PANEL_ICON = {
	category: "Tag",
	when: "Calendar",
	who: "Users",
	project: "Folder",
	more: "Ellipsis",
} as const;

/**
 * Add expense and Edit expense: the composer's one screen with the expense's
 * five panels (Category, When, Who, Project, More). It is a view of the
 * form: every answer is written to the draft the data layer already owns, and
 * Add sends what the dry run previewed.
 *
 * The keypad folds when there is an amount and the person picks something in
 * a panel, swipes, or taps a tab or a part of the line; tapping the amount
 * brings it back. An edit opens folded.
 */
export function ExpenseComposer({
	form,
	pv,
	split,
	lines,
	rate,
	catalog,
	onAdd,
	busy,
	onCancel,
	onModeChange,
	actions,
	notices,
	surface,
}: {
	form: EntryForm;
	pv: ComposerPreview;
	split: SplitView | null;
	lines: MoneyLine[];
	/** The rate line for an amount in another currency; null at home. */
	rate: ReactNode;
	catalog: EntryCatalog;
	onAdd: () => void;
	busy: boolean;
	onCancel: () => void;
	onModeChange: (mode: EntryMode) => void;
	/** The menu of a saved expense: Undo changes, Delete. */
	actions: MenuItem[];
	/** Sync issues and the shared-file notice, under the head. */
	notices: ReactNode;
	surface?: boolean;
}) {
	const t = useTranslations("mobile.composer");
	const { format } = useFormatMoney();
	const locale = useMoneyLocale();
	const { fontScale } = useWindowDimensions();
	const { space } = useTheme();
	const day = useDayWords();
	const draft = form.expense;
	const editing = draft.editing !== null;
	const personal = isPersonal(draft);
	const [page, setPage] = useState(0);
	// The person whose part of a split the keypad types; null: the amount.
	const [part, setPart] = useState<string | null>(null);
	const [picked, setPicked] = useState(false);
	const system = fontScale > SYSTEM_PAD_SCALE;

	// A pick in a panel, a swipe or a tap on a tab folds the keys away once
	// there is an amount to add, so the panel can use the room.
	const fold = useCallback(() => {
		if (form.typedAmount !== null) form.setPadOpen(false);
	}, [form]);
	const goTo = (next: number) => {
		setPage(next);
		if (next !== 2) setPart(null);
		fold();
	};
	const typeAmount = () => {
		setPart(null);
		form.requestKeypad();
	};
	const typePart = (key: string | null) => {
		setPart(key);
		if (key) form.requestKeypad();
	};

	const patch = (changes: Partial<ExpenseDraft>) => {
		form.patchExpense(changes);
		fold();
	};
	const pickOne = (category: EntryCategory | { id: string }) => {
		setPicked(true);
		patch(
			pickCategory(
				draft,
				"excludeByDefault" in category ? category : undefined,
				category.id,
			),
		);
	};

	// The title's memory picks the category for a title you have used, and says what it cost.
	const last = useTitleMemory({
		title: draft.title,
		enabled: !editing,
		categories: catalog.categories,
		picked,
		onPick: (id) =>
			form.patchExpense(
				pickCategory(
					draft,
					catalog.categories.find((c) => c.id === id),
					id,
				),
			),
	});

	// The summary line: the answers so far, each a way into its panel.
	const category =
		catalog.categories.find((c) => c.id === draft.categoryId)?.name ??
		draft.editing?.category?.name ??
		null;
	const project = catalog.projects.find((p) => p.id === draft.projectId);
	const members = split ? split.rows.length : 1;
	const payer = split
		? split.paidBy.key === split.rows.find((r) => r.you)?.key
			? t("summary.you")
			: split.paidBy.name
		: "";
	const extras: string[] = [];
	if (draft.note.trim()) extras.push(t("note"));
	if (personal && draft.spread)
		extras.push(t("spreadMonths", { count: draft.spread }));
	if (personal && draft.exclude) extras.push(t("summary.excluded"));
	if (personal && draft.location.trim()) extras.push(draft.location.trim());
	const parts = [
		{
			key: "category",
			text: category ?? t("errors.category"),
			tone: category ? undefined : ("attention" as const),
			page: 0,
		},
		{ key: "when", text: day.short(draft.date), page: 1 },
		{
			key: "who",
			text: split
				? t("summary.split", { count: members, name: payer })
				: t("summary.justYou"),
			page: 2,
		},
		{
			key: "project",
			text: project?.name ?? t("context.personal"),
			page: 3,
		},
		...extras.map((text) => ({ key: `more-${text}`, text, page: 4 })),
	].map((part) => ({
		key: part.key,
		text: part.text,
		tone: "tone" in part ? part.tone : undefined,
		active: page === part.page,
		onPress: () => goTo(part.page),
	}));

	const dots: Record<PanelName, boolean> = {
		category: false,
		when: draft.date !== day.today,
		who: split !== null,
		project: draft.projectId !== null,
		more: extras.length > 0,
	};
	const tabs: PagerTab[] = PANELS.map((name) => ({
		key: name,
		label: t(`tabs.${name}`),
		icon: PANEL_ICON[name],
		dot: dots[name],
	}));

	const people = draft.projectId ? draft.projectPeople : catalog.people;
	const panels = [
		<CategoryPanel
			catalog={catalog}
			draft={draft}
			error={form.tried && form.expenseProblems.category === true}
			key="category"
			onPick={pickOne}
		/>,
		<WhenPanel
			date={draft.date}
			key="when"
			// The system date control may report the day it already shows.
			onPick={(date) => {
				if (date !== draft.date) patch({ date });
			}}
		/>,
		<WhoPanel
			form={form}
			key="who"
			onPart={typePart}
			onPicked={fold}
			part={part}
			people={people}
			preview={pv}
			split={split}
		/>,
		<ProjectPanel
			editing={editing}
			key="project"
			onPick={(id) => {
				void form.pickProject(id);
				fold();
			}}
			projects={catalog.projects}
			value={draft.projectId}
		/>,
		<MorePanel form={form} key="more" onPicked={fold} preview={pv} />,
	];

	// What the keypad types: the amount, or the open part of a split.
	const money = lines[0] as MoneyLine;
	const partKind =
		split && split.mode !== "EQUAL" && part
			? split.mode === "EXACT"
				? ("money" as const)
				: split.mode === "PERCENTAGE"
					? ("percent" as const)
					: ("units" as const)
			: null;
	const keypad =
		part && partKind
			? {
					text: draft.parts[part] ?? "",
					currency: draft.currency,
					kind: partKind,
					onChange: (text: string) =>
						form.patchSplit({ parts: { ...draft.parts, [part]: text } }),
				}
			: {
					text: form.keypad.text,
					currency: form.keypad.currency,
					kind: "money" as const,
					onChange: form.patchAmount,
				};

	const memory = last ? (
		<Text style={{ textAlign: "center" }} tone="fg3" variant="meta">
			{t("lastTime", {
				amount: format(last, { cents: true }) ?? "",
			})}
		</Text>
	) : null;

	// The large text sizes keep the system decimal keyboard: the amount is a field.
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
			onPress={typeAmount}
		/>
	);

	return (
		<ComposerFrame
			add={{
				onPress: onAdd,
				label: editing ? t("save") : t("add"),
				description: editing ? t("saveExpense") : t("addExpense"),
				folded: editing ? t("save") : t("addExpense"),
				off: pv.blocked || form.typedAmount === null,
				busy,
			}}
			amount={amount}
			changedLabel={t("tabs.changed")}
			header={
				<View style={{ gap: space[2] }}>
					<ComposerTop
						actions={actions}
						editing={editing}
						mode={form.mode}
						modes={form.modes}
						onCancel={onCancel}
						onModeChange={onModeChange}
					/>
					{notices}
				</View>
			}
			keypad={keypad}
			keypadOpen={form.padOpen}
			onKeypadOpen={typeAmount}
			onPageChange={(next) => goTo(next)}
			onTab={() => goTo((page + 1) % PANELS.length)}
			page={page}
			panels={panels}
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
						label={t("titleField")}
						onChangeText={(title) => form.patchExpense({ title })}
						onTypingChange={form.setTyping}
						placeholder={t("titlePlaceholder")}
						value={draft.title}
					/>
					{memory}
				</View>
			}
			typing={form.typing}
		/>
	);
}
