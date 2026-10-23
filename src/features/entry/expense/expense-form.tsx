"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { fromMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor } from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Sheet } from "~/components/ui/sheet";
import { UnsavedChangesDialog } from "~/components/ui/unsaved-changes-dialog";
import { getImageUrl } from "~/lib/image-url";
import { FieldError, useSettled } from "../shared-ui";
import { api } from "~/trpc/react";
import { ChangesBlock } from "../changes";
import type { EntryCatalog } from "../shared-ui";
import type { EntryPerson, EntryRequest } from "../types";
import { useRateState } from "./amount-field";
import { isShared, validate } from "./draft";
import { ExpenseFields, type Project } from "./expense-fields";
import { sharesOf } from "./split-view";
import { useExpenseDraft } from "./use-expense-draft";
import type { ExpenseRequest, LoadedDraft } from "./use-expense-load";
import { useExpenseSave } from "./use-expense-save";

/** Projects you can add into, with their people (you left out). */
function useProjects(youId: string): Project[] {
	const { data } = api.project.list.useQuery({ status: "ACTIVE" });
	return useMemo(
		() =>
			(data ?? [])
				.filter((p) => p.myRole !== "VIEWER")
				.map((p) => ({
					id: p.id,
					name: p.name,
					coverUrl: getImageUrl(p.imagePath),
					primaryCurrency: p.primaryCurrency,
					members: p.participants
						.filter(
							(m) =>
								!(m.participantType === "user" && m.participantId === youId),
						)
						.map((m) => ({
							participantType: m.participantType,
							participantId: m.participantId,
							name: m.name,
							avatarUrl: m.avatarUrl ?? null,
						})),
				})),
		[data, youId],
	);
}

export function ExpenseForm(p: {
	request: ExpenseRequest;
	initial: LoadedDraft;
	catalog: EntryCatalog;
	you: EntryPerson;
	favorites?: readonly string[];
	onClose: () => void;
	onOpen: (r: EntryRequest) => void;
}) {
	const t = useTranslations("entry.expense");
	const tc = useTranslations("entry.changes");
	const home = p.catalog.homeCurrency;
	// The sheet's starting point, kept once: Undo changes and the unsaved check compare to it.
	const locale = useLocale();
	const [initial] = useState(() => withAmountText(p.initial, locale));
	const [failed, setFailed] = useState(false);
	const youRef = {
		participantType: p.you.participantType,
		participantId: p.you.participantId,
	};
	const x = useExpenseDraft(initial.draft, {
		you: youRef,
		home,
		categories: p.catalog.categories,
	});
	const { d } = x;
	const projects = useProjects(p.you.participantId);
	const shared = isShared(d);
	const shares = shared ? sharesOf(d, youRef) : null;
	const myShare = shares?.get(`user:${p.you.participantId}`) ?? null;
	const rate = useRateState(d, home, shared ? myShare : d.minor);
	const errors = validate(d, { home, you: youRef, rateMissing: rate.missing });
	const valid = Object.keys(errors).length === 0;
	const [tried, setTried] = useState(false);
	const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
	const closing = useRef(false);
	const submitting = useRef(false);
	const category = p.catalog.categories.find((c) => c.id === d.categoryId);
	const s = useExpenseSave(d, {
		home,
		you: youRef,
		categoryName: category?.name ?? "",
		valid,
	});
	const dirty = JSON.stringify(d) !== JSON.stringify(initial.draft);
	const dup = useDuplicate(d);
	const editing = d.editing;

	const title = editing
		? editing.source === "shared"
			? t("title.editShared")
			: t("title.edit")
		: p.request.mode === "create" && p.request.duplicate
			? t("title.duplicate")
			: p.request.mode === "create" && p.request.projectName
				? t("title.toProject", { project: p.request.projectName })
				: t("title.new");

	const close = () => {
		closing.current = true;
		p.onClose();
	};
	const requestClose = () =>
		dirty && !closing.current ? setConfirm("discard") : close();
	const submit = async (again?: boolean) => {
		setTried(true);
		setFailed(false);
		// One save at a time: a double click or Enter during a save does nothing.
		if (!valid || submitting.current) return false;
		submitting.current = true;
		try {
			await s.save(again);
		} catch {
			setFailed(true);
			return false;
		} finally {
			submitting.current = false;
		}
		if (again) {
			p.onOpen({
				kind: "expense",
				mode: "create",
				projectId: d.projectId ?? undefined,
				prefill: { currency: d.currency },
			});
			return false;
		}
		close();
	};

	return (
		<>
			<Sheet
				detent="large"
				footer={
					editing ? (
						<>
							<Button
								kind="ghost"
								onClick={() =>
									editing.source === "shared"
										? setConfirm("delete")
										: void s.remove().then(close, () => setFailed(true))
								}
							>
								{t("delete")}
							</Button>
							<Button
								disabled={!dirty}
								kind="ghost"
								onClick={() => x.set(initial.draft)}
							>
								{t("undoChanges")}
							</Button>
							<span className="flex-1" />
							<Button kind="secondary" onClick={requestClose}>
								{t("cancel")}
							</Button>
							<Button
								data-sheet-submit=""
								kind="primary"
								loading={s.busy}
								onClick={() => void submit()}
							>
								{t("save")}
							</Button>
						</>
					) : (
						<>
							<Button
								className="max-md:hidden"
								kind="ghost"
								onClick={requestClose}
							>
								{t("cancel")}
							</Button>
							<span className="flex-1 max-md:hidden" />
							<Button
								className="max-md:flex-1"
								kind="secondary"
								loading={s.busy}
								onClick={() => void submit(true)}
							>
								{t("addAndNew")}
							</Button>
							<Button
								className="max-md:flex-1"
								data-sheet-submit=""
								kind="primary"
								loading={s.busy}
								onClick={() => void submit()}
							>
								{t("add")}
							</Button>
						</>
					)
				}
				onOpenChange={(open) => (open ? undefined : requestClose())}
				onSubmit={() => submit()}
				open
				title={title}
			>
				<ExpenseFields
					bookedHome={initial.bookedHome}
					catalog={p.catalog}
					changes={
						<>
							<ChangesBlock
								byDesign={
									shared
										? ["accounts", "netWorth"]
										: ["accounts", "netWorth", "owed.owedToYou", "owed.youOwe"]
								}
								cannot={valid ? s.previewError : null}
								diff={valid ? s.preview : null}
								edit={!!editing}
								empty={tc("empty")}
								loading={s.previewLoading}
							/>
							{failed ? <FieldError text={t("error.save")} /> : null}
						</>
					}
					duplicate={dup}
					errors={errors}
					favorites={p.favorites}
					projects={projects}
					rate={rate}
					shares={shares}
					today={dayKey(new Date())}
					tried={tried}
					verified={initial.verified}
					x={x}
					you={p.you}
				/>
			</Sheet>
			<UnsavedChangesDialog
				description={t("discard.body")}
				onDiscard={close}
				onOpenChange={(o) => !o && setConfirm(null)}
				onStay={() => setConfirm(null)}
				open={confirm === "discard"}
				title={t("discard.title")}
			/>
			<ConfirmationDialog
				confirmLabel={t("deleteShared.confirm")}
				description={t("deleteShared.body")}
				isLoading={s.busy}
				onConfirm={() => void s.remove().then(close, () => setFailed(true))}
				onOpenChange={(o) => !o && setConfirm(null)}
				open={confirm === "delete"}
				title={t("deleteShared.title", { title: d.title })}
				variant="destructive"
			/>
		</>
	);
}

/** "A similar expense is already on this day" (create only, after a pause). */
function useDuplicate(d: ReturnType<typeof useExpenseDraft>["d"]) {
	const q = useSettled(
		d.editing === null && d.title.trim() && d.minor
			? {
					title: d.title.trim(),
					amount: Number(fromMinor({ minor: d.minor, currency: d.currency })),
					date: new Date(`${d.date}T12:00:00`),
				}
			: null,
		800,
	);
	const { data } = api.expense.checkDuplicate.useQuery(
		q ?? { title: "x", amount: 1, date: new Date() },
		{ enabled: !!q },
	);
	return !!q && !!data?.isDuplicate;
}

/** A saved or prefilled amount starts formatted in the reader's locale. */
function withAmountText(loaded: LoadedDraft, locale: string): LoadedDraft {
	const d = loaded.draft;
	if (!d.minor || d.amountText) return loaded;
	return {
		...loaded,
		draft: { ...d, amountText: draftFromMinor(d.minor, locale, d.currency) },
	};
}
