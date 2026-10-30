import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { ListRow } from "@/ui/List";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { CategoryList, loadCategories } from "./CategoryList";
import { participantKey, shareCategoryBody } from "./owedBodies";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";
import { BackButton, WriteForm } from "./WriteSheet";

/** A read that has not answered (rows in place) or failed (the message and Retry). */
function LoadState({
	status,
	onRetry,
}: {
	status: string;
	onRetry: () => void;
}) {
	const t = useTranslations("mobile.budget.unrouted");
	const tc = useTranslations("mobile.common");
	return status === "error" ? (
		<EmptyState
			actionLabel={tc("retry")}
			onAction={onRetry}
			title={t("error")}
		/>
	) : (
		<SkeletonRows count={2} />
	);
}

/**
 * Shares with no envelope: your part of someone else's split that found no
 * category of yours. They count in Everything else until you pick one. A row
 * opens the category pick; the server previews where it lands and what moves.
 */
export function UnroutedSheet({
	data,
	visible,
	detent = "large",
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.unrouted");
	const money = useMoneyText();
	const format = useFormatter();
	const [shareId, setShareId] = useState<string | null>(null);
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const shares = useSheetRead(visible, (client) =>
		client.budget.unroutedShares({}),
	);
	const people = useSheetRead(visible, (client) => client.budget.owed());
	const categories = useSheetRead(
		visible && shareId !== null,
		loadCategories,
		"cats",
	);
	const list = shares.status === "ready" ? shares.data : null;
	const share = list?.shares.find((s) => s.shareId === shareId) ?? null;
	const names = useMemo(
		() =>
			new Map(
				(people.status === "ready" ? (people.data?.people ?? []) : []).map(
					(p) => [participantKey(p.participant), p.name] as const,
				),
			),
		[people],
	);
	const nameOf = (s: { payer: { type: string; id: string } }) =>
		names.get(participantKey(s.payer)) ?? null;
	const day = (iso: string) =>
		format.dateTime(new Date(`${iso}T00:00:00Z`), {
			dateStyle: "medium",
			timeZone: "UTC",
		});

	useEffect(() => {
		if (!visible) return;
		setShareId(null);
		setCategoryId(null);
	}, [visible]);

	const { idFor } = useWriteIds(JSON.stringify([shareId, categoryId]));
	const body = share
		? shareCategoryBody({ expenseId: share.expenseId, categoryId })
		: null;

	return (
		<Sheet
			detents={[detent]}
			onClose={onClose}
			title={share ? t("pickTitle") : t("title")}
			visible={visible}
		>
			<SheetBody>
				{share ? (
					<>
						<BackButton
							label={t("back")}
							onPress={() => {
								setShareId(null);
								setCategoryId(null);
							}}
						/>
						<WriteForm
							data={data}
							idempotencyKey={body ? idFor("share") : null}
							input={body}
							message={() => t("routedToast")}
							onClose={() => {
								setShareId(null);
								setCategoryId(null);
							}}
							onDone={() => {
								shares.reload();
								onDone();
							}}
							preview={(api, b) => api.budget.previewSetShareCategory(b)}
							submitLabel={t("route")}
							write={(api, b, key) =>
								api.budget.setShareCategory(b, {
									context: { idempotencyKey: key },
								})
							}
						>
							<Note>{t("pickLead")}</Note>
							{categories.status === "ready" ? (
								<CategoryList
									categories={categories.data}
									onPress={setCategoryId}
									selected={new Set(categoryId ? [categoryId] : [])}
								/>
							) : (
								<LoadState
									onRetry={categories.reload}
									status={categories.status}
								/>
							)}
						</WriteForm>
					</>
				) : (
					<>
						{shares.status === "error" || shares.status === "loading" ? (
							<LoadState onRetry={shares.reload} status={shares.status} />
						) : null}
						{list && list.count === 0 ? <Note>{t("none")}</Note> : null}
						{list && list.count > 0 ? (
							<Note>
								{t("lead", {
									name:
										data.groups
											.flatMap((g) => g.envelopes)
											.find((e) => e.id === list.defaultEnvelopeId)?.name ??
										t("everythingElse"),
								})}
							</Note>
						) : null}
						<View>
							{(list?.shares ?? []).map((s) => {
								const who = nameOf(s);
								return (
									<ListRow
										accessibilityLabel={t("pickFor", { date: day(s.date) })}
										end={
											<Text tabular>
												{s.amount ? money(s.amount) : t("noRate")}
											</Text>
										}
										key={s.shareId}
										lead={
											<Avatar
												face={{ key: participantKey(s.payer), name: who ?? "" }}
											/>
										}
										onPress={() => setShareId(s.shareId)}
										sub={
											who
												? `${t("paidBy", { name: who })}, ${day(s.date)}`
												: day(s.date)
										}
										title={t("shareTitle")}
									/>
								);
							})}
						</View>
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}
