import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import type { ComposerPrefill } from "@/surfaces/prefill";
import { EmptyState } from "@/ui/EmptyState";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import type { MenuItem } from "@/ui/types";
import { useMoneyLines } from "./AmountCard";
import { DeleteEntrySheet } from "./DeleteEntrySheet";
import { ExpenseComposer } from "./ExpenseComposer";
import { type SavedEntry, useEditEntry, useEntryCatalog } from "./hooks";
import { IncomeComposer } from "./IncomeComposer";
import { RateField } from "./RateField";
import { SyncIssues } from "./SyncIssues";
import { TransferComposer } from "./TransferComposer";
import type { EntryCatalog, EntryMode } from "./types";
import { useComposerPreview } from "./useComposerPreview";
import { useEntryForm } from "./useEntryForm";
import { useEntrySave } from "./useEntrySave";
import { useSplitView } from "./useSplitView";

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
	// Retry starts the reads over: a new key remounts the loader.
	const [attempt, setAttempt] = useState(0);
	return (
		<ComposerLoader
			key={attempt}
			{...props}
			onRetry={() => setAttempt((n) => n + 1)}
		/>
	);
}

/** The reads the composer waits for: loading rows, or the error with Retry. */
function ComposerLoader({
	onRetry,
	...props
}: ComposerProps & { onRetry: () => void }) {
	const t = useTranslations("mobile.composer");
	const catalog = useEntryCatalog();
	const edit = useEditEntry(props.editId, props.editShared);
	const { state } = useSession();
	// The profile is cached on sign in; without it there is no "you" to split with.
	if (state.status !== "signedIn" || !state.me) {
		return (
			<Notice
				detail={t("loadErrorDetail")}
				onRetry={onRetry}
				title={t("loadError")}
			/>
		);
	}
	if (catalog.status === "loading") {
		return <Notice loading />;
	}
	if (catalog.status === "error") {
		return (
			<Notice
				detail={t("loadErrorDetail")}
				onRetry={onRetry}
				title={t("loadError")}
			/>
		);
	}
	if (edit.status === "loading") return <Notice loading />;
	if (edit.status === "error") {
		return (
			<Notice
				detail={t("loadErrorDetail")}
				onRetry={onRetry}
				title={t("editLoadError")}
			/>
		);
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

/**
 * A state in the sheet's own surface (the loading panel is transparent, never
 * a gray box): rows while it loads, a message with Retry when it failed, a
 * plain message when nothing can change.
 */
function Notice({
	title,
	detail,
	loading = false,
	onRetry,
}: {
	title?: string;
	detail?: string;
	loading?: boolean;
	onRetry?: () => void;
}) {
	const tc = useTranslations("mobile.common");
	return (
		<View style={{ flex: 1 }}>
			{loading ? (
				<SkeletonRows />
			) : (
				<EmptyState
					actionLabel={onRetry ? tc("retry") : undefined}
					detail={detail}
					onAction={onRetry}
					title={title ?? ""}
				/>
			)}
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
	onModeChange: told,
	surface,
	prefill,
	edit,
	onDirtyChange,
}: FormProps) {
	const t = useTranslations("mobile.composer");
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
	const { mode, expense, rated, tried } = form;

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

	const underAmount = rate;

	const notices = (
		<>
			<SyncIssues />
			{prefill?.file ? <Text tone="fg2">{t("sharedFileNotice")}</Text> : null}
		</>
	);

	const onModeChange = (next: EntryMode) => {
		form.setMode(next);
		form.setTried(false);
		form.setTarget("amount");
		told?.(next);
	};

	// A saved expense's menu: Undo changes once something changed, and Delete.
	const actions: MenuItem[] = [
		...(form.dirty && form.editing
			? [{ id: "undo", label: t("undoChanges"), onPress: form.undoChanges }]
			: []),
		...(canDelete
			? [
					{
						id: "delete",
						label: t("delete.row"),
						destructive: true,
						onPress: () => setDeleting(true),
					},
				]
			: []),
	];

	const deleteSheet = canDelete ? (
		<DeleteEntrySheet
			id={expense.id}
			onClose={() => setDeleting(false)}
			onDeleted={onDone}
			shared={edit?.kind === "shared"}
			title={expense.title}
			visible={deleting}
		/>
	) : null;

	if (mode === "expense") {
		return (
			<>
				<ExpenseComposer
					actions={actions}
					busy={busy}
					catalog={catalog}
					form={form}
					lines={lines}
					notices={notices}
					onAdd={add}
					onCancel={onDone}
					onModeChange={onModeChange}
					pv={pv}
					rate={underAmount}
					split={split}
					surface={surface}
				/>
				{deleteSheet}
			</>
		);
	}

	if (mode === "income") {
		return (
			<IncomeComposer
				busy={busy}
				catalog={catalog}
				form={form}
				lines={lines}
				notices={notices}
				onAdd={add}
				onCancel={onDone}
				onModeChange={onModeChange}
				pv={pv}
				rate={underAmount}
				surface={surface}
			/>
		);
	}

	return (
		<TransferComposer
			busy={busy}
			catalog={catalog}
			form={form}
			lines={lines}
			notices={notices}
			onAdd={add}
			onCancel={onDone}
			onModeChange={onModeChange}
			pv={pv}
			surface={surface}
		/>
	);
}
