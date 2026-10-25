"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import {
	CategoryPicker,
	type PickerCategory,
} from "~/components/pickers/category-picker";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api, type RouterOutputs } from "~/trpc/react";
import { useCategoryList } from "./category-checks";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import { useMoneyWrite } from "./use-money-write";
import { type EnvelopeInGroup, useMonth } from "./use-month";

type Unrouted = NonNullable<RouterOutputs["envelope"]["unroutedShares"]>;
type Share = Unrouted["shares"][number];

/** Pick a category for one share; the preview says where it lands and what moves. */
function ShareCategorySheet({
	share,
	month,
	envelopes,
	onClose,
}: {
	share: Share | null;
	month: number | undefined;
	envelopes: readonly EnvelopeInGroup[];
	onClose: () => void;
}) {
	const t = useTranslations("budgetSheets.splits");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const cats = useCategoryList(envelopes);
	const [picked, setPicked] = useState<string | null>(null);
	const preview = api.envelope.setShareCategoryPreview.useMutation();
	const commit = api.envelope.setShareCategory.useMutation();
	const input =
		share && picked
			? {
					transactionId: share.expenseId,
					categoryId: picked,
					source: "USER" as const,
				}
			: null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("routedToast"),
		undo: (r, i) => () =>
			commit.mutateAsync({
				transactionId: i.transactionId,
				categoryId: r.value.previous.categoryId,
				source: r.value.previous.source ?? "USER",
			}),
	});
	const categories: PickerCategory[] = cats.list.map((c) => ({
		id: c.id,
		name: c.name,
		icon: c.icon,
		tone: c.tone,
	}));
	const lands = picked ? (cats.byId.get(picked)?.owner ?? null) : null;
	const target =
		lands ??
		(m.data ? (m.byId.get(m.data.book.defaultEnvelopeId) ?? null) : null);
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => {
				if (!o) {
					setPicked(null);
					onClose();
				}
			}}
			onSubmit={async () => {
				const r = await w.submit();
				if (r !== false) {
					setPicked(null);
					onClose();
				}
				return r;
			}}
			open={share !== null}
			submitDisabled={!w.ready}
			submitLabel={t("route")}
			title={t("pickTitle")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("pickLead")}</p>
				<CategoryPicker
					categories={categories}
					onChange={setPicked}
					value={picked}
				/>
				{picked ? (
					<FigureChanges
						dry={w.dry}
						own={() =>
							target
								? [
										{
											key: "lands",
											label: t("lands"),
											value: target.name,
										},
									]
								: []
						}
						poolName={pool}
					/>
				) : null}
			</div>
		</Sheet>
	);
}

/**
 * Shares with no envelope (SPEC §5.8): your part of someone else's split that
 * found no category of yours. They count in Everything else until you pick
 * one; each row opens the category pick, previewed by the server.
 */
export function UnroutedShares({ month }: { month: number | undefined }) {
	const t = useTranslations("budgetSheets.splits");
	const f = useDateFormat();
	const m = useMonth(month);
	const shares = api.envelope.unroutedShares.useQuery({});
	const owed = api.envelope.owed.useQuery();
	const [share, setShare] = useState<Share | null>(null);
	const nameOf = useMemo(() => {
		const map = new Map(
			(owed.data?.people ?? []).map((p) => [
				`${p.participant.type}:${p.participant.id}`,
				p.name,
			]),
		);
		return (s: Share) => map.get(`${s.payer.type}:${s.payer.id}`) ?? null;
	}, [owed.data]);
	const data = shares.data ?? null;
	if (shares.isLoading) return <SkeletonRows count={2} />;
	if (!data || data.count === 0) return null;
	const home = m.byId.get(data.defaultEnvelopeId)?.name ?? t("everythingElse");
	return (
		<section aria-label={t("unroutedTitle")} className="flex flex-col gap-2">
			<h3 className="text-fg text-small font-semibold">{t("unroutedTitle")}</h3>
			<p className="text-fg-2 text-small">
				{t("unroutedLead", { name: home })}
			</p>
			<RowList label={t("unroutedTitle")} variant="flat">
				{data.shares.map((s) => {
					const who = nameOf(s);
					return (
						<Row
							end={
								s.amount ? (
									<Money value={s.amount} />
								) : (
									<span className="text-fg-3">{t("noRate")}</span>
								)
							}
							key={s.shareId}
							lead={<Face name={who ?? ""} />}
							open={{
								onOpen: () => setShare(s),
								label: t("pickFor", { date: f.medium(s.date) }),
							}}
							sub={
								<RowSub
									parts={[
										who ? t("paidBy", { name: who }) : null,
										f.medium(s.date),
									]}
								/>
							}
							title={t("shareTitle")}
						/>
					);
				})}
			</RowList>
			<ShareCategorySheet
				envelopes={m.envelopes}
				month={month}
				onClose={() => setShare(null)}
				share={share}
			/>
		</section>
	);
}
