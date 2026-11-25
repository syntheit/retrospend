"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { api } from "~/trpc/react";
import { usePreview } from "../corrections/use-preview";
import { ChangesBlock, type PreviewDiff } from "../entry/changes";

/** Places deleting a template never touches: the entries it logged stay. */
const STAYS = ["spent", "accounts"] as const;
/** The quarter and year costs say what the month's line says. */
const HIDDEN = /^recurring\.cost\.(in|out)\.(quarter|year)$/;

/** The ids in the dry run that the month's line already says. */
function hiddenIds(diff: PreviewDiff | null) {
	if (!diff) return [];
	return [
		...diff.changes.map((c) => c.id),
		...diff.unchanged.map((u) => u.id),
		...diff.unavailable.map((u) => u.id),
	].filter((id) => HIDDEN.test(id));
}

const row = "text-small flex min-h-6 items-baseline justify-between gap-3";

/**
 * The step before a recurring template is deleted (R30): the server's dry run
 * of the same delete says what it changes (what recurring costs and, when a
 * BILL envelope followed it, the plan cost) and what it does not (the entries
 * it logged). Delete is the danger button and the toast after it undoes it.
 */
export function DeleteSheet({
	item,
	today,
	onOpenChange,
	onDelete,
}: {
	item: RecurringItemDTO;
	today: string;
	onOpenChange: (open: boolean) => void;
	/** Throws the words to show when it fails. */
	onDelete: () => Promise<void>;
}) {
	const t = useTranslations("activityRecurring.deleteSheet");
	const { short } = useRowDates(today);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const preview = api.recurring.delete.preview.useMutation();
	const dry = usePreview((id: string) => preview.mutateAsync({ id }), item.id);

	const submit = async () => {
		setError(null);
		setBusy(true);
		try {
			await onDelete();
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : t("failed"));
			setBusy(false);
		}
	};

	return (
		<Sheet
			detent="medium"
			footer={
				<>
					<Button kind="secondary" onClick={() => onOpenChange(false)}>
						{t("cancel")}
					</Button>
					<Button
						data-sheet-submit=""
						disabled={!dry.fresh || busy}
						kind="danger"
						loading={busy}
						onClick={() => void submit()}
					>
						{t(item.direction === "in" ? "submitIn" : "submit")}
					</Button>
				</>
			}
			onOpenChange={onOpenChange}
			open
			title={t("title", { name: item.title })}
		>
			<ChangesBlock
				byDesign={STAYS}
				cannot={dry.error === null ? null : t("previewFailed")}
				diff={dry.data}
				hide={hiddenIds(dry.data)}
				loading={dry.loading}
				rows={
					dry.data ? (
						<>
							<div className={row}>
								<span className="text-fg-2">{t("future")}</span>
								<span>{t("futureValue", { date: short(item.next) })}</span>
							</div>
							{item.autoPay ? (
								<div className={row}>
									<span className="text-fg-2">{t("autoPay")}</span>
									<span>{t("autoPayValue")}</span>
								</div>
							) : null}
							{dry.data.envelopeTargets > 0 ? (
								<div className={row}>
									<span className="text-fg-2">{t("targets")}</span>
									<span>{t("targetsValue")}</span>
								</div>
							) : null}
							<div className={row}>
								<span className="text-fg-2">{t("logged")}</span>
								<span>{t("loggedValue")}</span>
							</div>
						</>
					) : null
				}
			/>
			{error ? (
				<p className="text-danger text-small mt-3" role="alert">
					{error}
				</p>
			) : null}
		</Sheet>
	);
}
