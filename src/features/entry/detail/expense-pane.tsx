"use client";

import { toMinorUnits } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useMemo } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Money } from "~/components/money/money";
import { useRateFormat } from "~/components/money/use-rate-format";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Button } from "~/components/ui/button";
import { DetailPane } from "~/components/ui/detail-pane";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { Tip } from "~/components/ui/tooltip";
import { saveError } from "~/features/activity/error-code";
import { useFixState } from "~/features/corrections/use-fix-state";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { useEntrySheets } from "../context";
import { useEntryActions } from "../entry-actions";
import { ReadFacts, Row } from "../read/read-view";
import { type PaneTarget, usePaneRoute } from "./pane-route";

type PaneProps = { onClose: () => void; phone: boolean };

/** The body of the pane while a query is on its way, or when it failed. */
function Waiting({ failed }: { failed: boolean }) {
	const t = useTranslations("entry.read");
	return failed ? (
		<p className="text-danger text-small" role="alert">
			{t("notAvailable")}
		</p>
	) : (
		<Skeleton className="h-40 w-full" />
	);
}

/** Pencil (the existing edit composer) and the overflow with the row menu's items. */
function PaneActions({
	edit,
	menu,
	editLabel,
}: {
	edit: (() => void) | null;
	menu: React.ReactNode;
	editLabel: string;
}) {
	return (
		<>
			{edit ? (
				<Tip content={editLabel}>
					<Button aria-label={editLabel} icon kind="ghost" onClick={edit}>
						<Pencil aria-hidden="true" />
					</Button>
				</Tip>
			) : null}
			{menu}
		</>
	);
}

/** One of your own expenses: facts only, edit in the composer. */
function PersonalPane({ id, onClose, phone }: PaneProps & { id: string }) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const types = useTranslations("activity.rateTypes");
	const rates = useRateFormat();
	const { label } = useDateFormat();
	const toast = useToast();
	const sheets = useEntrySheets();
	const entry = useEntryActions();
	const utils = api.useUtils();
	const q = api.entry.expense.get.useQuery({ id });
	const del = api.entry.expense.delete.save.useMutation();
	const restore = api.entry.expense.restore.save.useMutation();
	const e = q.data;
	const ta = useTranslations("activity.actions");

	const refresh = useCallback(async () => {
		await Promise.all([
			utils.expense.listV2.invalidate(),
			utils.entry.expense.get.invalidate({ id }),
		]);
	}, [utils, id]);

	const target = useMemo<ExpenseTarget | null>(
		() =>
			e
				? {
						id: e.id,
						name: e.title,
						mine: true,
						locked: false,
						reviewed: true,
						shared: false,
					}
				: null,
		[e],
	);
	const handlers = useMemo<ActionHandlers<ExpenseTarget>>(
		() => ({
			edit: () => sheets.open({ kind: "expense", mode: "edit", id }),
			duplicate: () => {
				if (!e) return;
				entry.openDuplicateExpense({
					title: e.title,
					amount: e.amount,
					currency: e.currency,
					categoryId: e.categoryId,
				});
			},
			delete: async () => {
				if (!e) return;
				try {
					const out = await del.mutateAsync({ id });
					onClose();
					toast.saved(ta("deleted", { name: e.title }), {
						undo: async () => {
							await restore.mutateAsync({ token: out.value.restore });
							await refresh();
						},
					});
				} catch (error) {
					toast.failed(ta(`error.${saveError(error)}`));
				}
				await refresh();
			},
		}),
		[sheets, id, e, entry, del, restore, onClose, toast, ta, refresh],
	);

	const typeName = e?.rateType
		? types.has(e.rateType)
			? types(e.rateType)
			: e.rateType
		: null;
	const rate =
		e && e.home && e.rate && e.currency !== e.home.currency
			? typeName
				? rates.typed(typeName, e.currency, e.home.currency, e.rate)
				: rates.rate(e.currency, e.home.currency, e.rate)
			: null;

	return (
		<DetailPane
			actions={
				target ? (
					<PaneActions
						edit={() => sheets.open({ kind: "expense", mode: "edit", id })}
						editLabel={t("edit")}
						menu={
							<ActionMenu
								entity="expense"
								handlers={handlers}
								target={target}
							/>
						}
					/>
				) : null
			}
			closeLabel={phone ? t("back") : t("close")}
			onClose={onClose}
			phone={phone}
			title={e?.title ?? tr("amount")}
		>
			{!e ? (
				<Waiting failed={q.isError} />
			) : (
				<div className="flex flex-col gap-1" data-entry-read="">
					<Row k={tr("amount")}>
						<Money
							figure={`entry.amount:personal:${e.id}`}
							value={{
								minor: toMinorUnits(e.amount, e.currency),
								currency: e.currency,
							}}
						/>
					</Row>
					{e.home && e.home.currency !== e.currency ? (
						<Row k={t("home", { currency: e.home.currency })}>
							<Money figure={`entry.home:personal:${e.id}`} value={e.home} />
						</Row>
					) : null}
					{rate ? <Row k={t("rate")}>{rate}</Row> : null}
					{e.category ? <Row k={tr("category")}>{e.category.name}</Row> : null}
					<Row k={tr("date")}>{label.long(dayKey(new Date(e.date)))}</Row>
					{e.location ? <Row k={t("location")}>{e.location}</Row> : null}
					{e.description ? <Row k={t("note")}>{e.description}</Row> : null}
				</div>
			)}
		</DetailPane>
	);
}

/** A shared expense: facts, and what the corrections router allows. */
function SharedPane({ id, onClose, phone }: PaneProps & { id: string }) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const ta = useTranslations("activity.actions");
	const toast = useToast();
	const sheets = useEntrySheets();
	const utils = api.useUtils();
	const { data: session } = useSession();
	const me = session?.user?.id;
	const q = api.sharedTransaction.getById.useQuery({ id });
	const fix = useFixState(id, me);
	const del = api.sharedTransaction.delete.useMutation();
	const tx = q.data;
	const lock = fix.lock;

	const target = useMemo<ExpenseTarget | null>(
		() =>
			tx
				? {
						id: tx.id,
						name: tx.description,
						mine: tx.canEdit || !!lock?.canCorrect,
						locked: tx.isLocked,
						reviewed: true,
						shared: true,
					}
				: null,
		[tx, lock?.canCorrect],
	);
	const handlers = useMemo<ActionHandlers<ExpenseTarget>>(
		() => ({
			edit: () => sheets.open({ kind: "shared", id }),
			...(lock?.canAskToFix
				? { askFix: () => sheets.open({ kind: "shared", id, start: "ask" }) }
				: {}),
			...(lock?.canCorrect
				? {
						correct: () =>
							sheets.open({ kind: "shared", id, start: "correct" }),
					}
				: {}),
			delete: async () => {
				if (!tx) return;
				try {
					await del.mutateAsync({ id });
					onClose();
					toast.saved(ta("deleted", { name: tx.description }));
				} catch (error) {
					toast.failed(ta(`error.${saveError(error)}`));
				}
				await utils.expense.listV2.invalidate();
			},
		}),
		[sheets, id, lock, tx, del, onClose, toast, ta, utils],
	);

	return (
		<DetailPane
			actions={
				target ? (
					<PaneActions
						edit={
							tx?.canEdit ? () => sheets.open({ kind: "shared", id }) : null
						}
						editLabel={t("edit")}
						menu={
							<ActionMenu
								entity="expense"
								handlers={handlers}
								target={target}
							/>
						}
					/>
				) : null
			}
			closeLabel={phone ? t("back") : t("close")}
			onClose={onClose}
			phone={phone}
			title={tx?.description ?? tr("amount")}
		>
			{!tx ? (
				<Waiting failed={q.isError} />
			) : (
				<ReadFacts me={me} notice={null} quote={null} tx={tx} />
			)}
		</DetailPane>
	);
}

function PaneBody({
	target,
	onClose,
}: {
	target: PaneTarget;
	onClose: () => void;
}) {
	const phone = useIsMobile();
	// The id keys the pane, so a second expense starts clean.
	return target.kind === "personal" ? (
		<PersonalPane
			id={target.id}
			key={target.id}
			onClose={onClose}
			phone={phone}
		/>
	) : (
		<SharedPane
			id={target.id}
			key={target.id}
			onClose={onClose}
			phone={phone}
		/>
	);
}

function Host() {
	const { target, close } = usePaneRoute();
	if (!target) return null;
	return <PaneBody onClose={close} target={target} />;
}

/**
 * The expense detail pane host (T2): the shell mounts it beside the page, so
 * Activity, Projects, People and the palette share one pane. It reads the
 * URL (?expense= or ?shared=), so Back closes it.
 */
export function ExpensePaneHost() {
	return (
		<Suspense fallback={null}>
			<Host />
		</Suspense>
	);
}
