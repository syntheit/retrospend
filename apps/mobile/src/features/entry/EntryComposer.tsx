import { useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMoneyLocale } from "@/lib/money";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { applyKey } from "@/ui/keypad";
import { Text } from "@/ui/Text";
import { useMoneyLines } from "./AmountCard";
import { ComposerHeader } from "./ComposerHeader";
import { ComposerShell, type EntryMode } from "./ComposerShell";
import { DeleteEntrySheet } from "./DeleteEntrySheet";
import { ExpenseFields } from "./ExpenseFields";
import { type SavedEntry, useEditEntry, useEntryCatalog } from "./hooks";
import { IncomeFields } from "./IncomeFields";
import { MoreStep, StepSlide } from "./MoreStep";
import { PreviewLine } from "./PreviewLine";
import { ProjectPick } from "./ProjectPick";
import { RateField } from "./RateField";
import { useSplitView } from "./SplitGroup";
import { SyncIssues } from "./SyncIssues";
import { TransferFields } from "./TransferFields";
import type { EntryCatalog } from "./types";
import { useComposerPreview } from "./useComposerPreview";
import { useEntryForm } from "./useEntryForm";
import { useEntrySave } from "./useEntrySave";

interface ComposerProps {
	onDone: () => void;
	initialMode?: EntryMode;
	/** The host shows the mode in its title. */
	onModeChange?: (mode: EntryMode) => void;
	/** The composer sits on a sheet: it takes the sheet's surface, not the page's. */
	surface?: boolean;
	/** What a share, a Shortcut or a retrospend://add link filled in. */
	prefill?: ComposerPrefill;
	/** The saved expense to edit; the composer then edits it instead of adding. */
	editId?: string;
	/** The id is a split expense's, not a personal one's. */
	editShared?: boolean;
	/** Told whether anything was typed or picked since the composer opened. */
	onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Add expense, Add income and Add transfer in one frame. The same component
 * sits in the iPhone tab, the iPad form sheet and the Android bottom sheet;
 * `onDone` closes whichever it is in.
 */
export function EntryComposer(props: ComposerProps) {
	const t = useTranslations("mobile.composer");
	const catalog = useEntryCatalog();
	const edit = useEditEntry(props.editId, props.editShared);
	const { state } = useSession();
	// The profile is cached on sign in; without it there is no "you" to split with.
	if (state.status !== "signedIn" || !state.me) {
		return <Notice detail={t("loadErrorDetail")} title={t("loadError")} />;
	}
	if (catalog.status === "loading") {
		return <Notice title={t("loading")} />;
	}
	if (catalog.status === "error") {
		return <Notice detail={t("loadErrorDetail")} title={t("loadError")} />;
	}
	if (edit.status === "loading") return <Notice title={t("loading")} />;
	if (edit.status === "error") {
		return <Notice detail={t("loadErrorDetail")} title={t("editLoadError")} />;
	}
	if (edit.status === "ready" && edit.saved.kind === "shared") {
		// A payment settled it, or the project does not let you: the server refuses either.
		if (!edit.saved.entry.canEdit) {
			return <Notice detail={t("editLockedDetail")} title={t("editLocked")} />;
		}
	}
	return (
		<Form
			{...props}
			catalog={catalog.catalog}
			edit={edit.status === "ready" ? edit.saved : undefined}
		/>
	);
}

/** A message in the sheet's own surface; the loading panel is transparent, never a gray box. */
function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<View style={{ flex: 1 }}>
			<EmptyState detail={detail} title={title} />
		</View>
	);
}

type FormProps = ComposerProps & {
	catalog: EntryCatalog;
	edit?: SavedEntry;
};

function Form({
	catalog,
	initialMode = "expense",
	onDone,
	onModeChange,
	surface,
	prefill,
	edit,
	onDirtyChange,
}: FormProps) {
	const t = useTranslations("mobile.composer");
	const locale = useMoneyLocale();
	const { space } = useTheme();
	const form = useEntryForm({
		catalog,
		initialMode,
		prefill,
		edit,
		onDirtyChange,
	});
	const pv = useComposerPreview(form);
	const { add, busy } = useEntrySave({
		form,
		write: pv.write,
		blocked: pv.blocked,
		onDone,
	});
	const lines = useMoneyLines(form);
	const split = useSplitView(form, pv, edit);
	const [deleting, setDeleting] = useState(false);
	// Every saved expense deletes from here; a split asks first and Undo brings
	// back every share.
	const canDelete = form.editing && edit !== undefined;
	// The More step slides in the first time it opens; the quick step is just there.
	const visitedMore = useRef(false);
	if (form.step === "more") visitedMore.current = true;

	const { mode, expense, income, transfer, rated, tried } = form;

	function goTo(step: "quick" | "more") {
		// A field that unmounts never reports its blur.
		Keyboard.dismiss();
		form.setTyping(false);
		form.setStep(step);
	}

	const rate =
		rated && form.foreign ? (
			<RateField
				choice={rated}
				currency={rated.currency}
				error={tried && form.rateProblem === true}
				homeCurrency={form.homeCurrency}
				keptHome={mode === "expense" ? (expense.editing?.home ?? null) : null}
				onChange={(patch) =>
					mode === "income" ? form.patchIncome(patch) : form.patchExpense(patch)
				}
				onTypingChange={form.setTyping}
				options={form.rateOptions}
				shared={form.sharedExpense}
			/>
		) : null;

	// Between currencies the hint sits under the second row, in the amount card.
	const underAmount =
		mode === "transfer" ? (
			form.exchange ? (
				<Text tone="fg2" variant="small">
					{t("transfer.receivedHint")}
				</Text>
			) : null
		) : (
			rate
		);

	// In a project the split is about the project's people, not your latest ones.
	const people = expense.projectId ? expense.projectPeople : catalog.people;
	const context =
		mode === "expense" && !form.editing && catalog.projects.length > 0 ? (
			<ProjectPick
				onChange={form.pickProject}
				projects={catalog.projects}
				value={expense.projectId}
				variant="pill"
			/>
		) : null;

	return (
		<>
			<ComposerShell
				addDescription={
					form.editing
						? t("saveExpense")
						: mode === "expense"
							? t("addExpense")
							: mode === "income"
								? t("addIncome")
								: t("addTransfer")
				}
				addLabel={form.editing ? t("save") : t("add")}
				addOff={pv.blocked || form.typedAmount === null}
				amountError={tried && form.amountProblem === true}
				busy={busy}
				header={
					<ComposerHeader
						context={context}
						editing={form.editing}
						mode={mode}
						modes={form.modes}
						onModeChange={(next) => {
							form.setMode(next);
							form.setTried(false);
							form.setTarget("amount");
							onModeChange?.(next);
						}}
						onMore={() => goTo("more")}
						step={form.step}
						undoChanges={form.dirty && form.editing ? form.undoChanges : null}
					/>
				}
				keypad={{
					text: form.keypad.text,
					currency: form.keypad.currency,
					onChange: form.patchAmount,
				}}
				lines={lines}
				onAdd={add}
				onBack={() => goTo("quick")}
				onOperator={(sign) =>
					form.patchAmount(
						applyKey(form.keypad.text, sign, locale, form.keypad.currency),
					)
				}
				onScrollDrag={() => form.setPadOpen(false)}
				padOpen={form.padOpen}
				preview={<PreviewLine state={pv.preview} />}
				rate={underAmount}
				step={form.step}
				surface={surface}
				typing={form.typing}
			>
				{form.step === "more" ? (
					<StepSlide animate from={1} key="more">
						<MoreStep
							edit={edit}
							form={form}
							onDelete={canDelete ? () => setDeleting(true) : null}
							preview={pv}
							rate={rate}
						/>
					</StepSlide>
				) : (
					<StepSlide animate={visitedMore.current} from={-1} key="quick">
						<View style={{ gap: space[4] }}>
							<SyncIssues />
							{prefill?.file ? (
								<Text tone="fg2">{t("sharedFileNotice")}</Text>
							) : null}
							{mode === "expense" ? (
								<ExpenseFields
									catalog={catalog}
									draft={expense}
									errors={tried ? form.expenseProblems : {}}
									onChange={form.patchExpense}
									onMore={() => goTo("more")}
									onTypingChange={form.setTyping}
									people={people}
									split={
										split
											? { mode: split.mode, yourShare: split.yourShare }
											: null
									}
								/>
							) : mode === "income" ? (
								<IncomeFields
									catalog={catalog}
									draft={income}
									errors={tried ? form.incomeProblems : {}}
									onChange={form.patchIncome}
									onTypingChange={form.setTyping}
								/>
							) : (
								<TransferFields
									draft={transfer}
									errors={tried ? form.transferProblems : {}}
									onChange={form.patchTransfer}
									onTypingChange={form.setTyping}
									places={catalog.places}
								/>
							)}
						</View>
					</StepSlide>
				)}
			</ComposerShell>
			{canDelete ? (
				<DeleteEntrySheet
					id={expense.id}
					onClose={() => setDeleting(false)}
					onDeleted={onDone}
					shared={edit?.kind === "shared"}
					title={expense.title}
					visible={deleting}
				/>
			) : null}
		</>
	);
}
