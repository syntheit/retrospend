import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { Face } from "@/features/entry/Face";
import { LinkButton, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Sheet } from "@/ui/Sheet";
import { CategoryList, loadCategories } from "./CategoryList";
import { participantKey, shareCategoryBody } from "./owedBodies";
import { Note, SheetBody } from "./parts";
import type { BudgetMonth } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteForm } from "./WriteSheet";

/**
 * Shares with no envelope: your part of someone else's split that found no
 * category of yours. They count in Everything else until you pick one. A row
 * opens the category pick; the server previews where it lands and what moves.
 */
export function UnroutedSheet({
	data,
	visible,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.unrouted");
	const money = useMoneyText();
	const format = useFormatter();
	const { color, size, space, type } = useTheme();
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
			detents={["large"]}
			onClose={onClose}
			title={share ? t("pickTitle") : t("title")}
			visible={visible}
		>
			<SheetBody>
				{share ? (
					<>
						<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
							<LinkButton
								label={t("back")}
								onPress={() => {
									setShareId(null);
									setCategoryId(null);
								}}
							/>
						</View>
						<WriteForm
							data={data}
							idempotencyKey={body ? idFor("share") : null}
							input={body}
							message={t("routedToast")}
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
								<Note>
									{categories.status === "error" ? t("error") : t("loading")}
								</Note>
							)}
						</WriteForm>
					</>
				) : (
					<>
						{shares.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
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
										key={s.shareId}
										onPress={() => setShareId(s.shareId)}
									>
										<Face
											diameter={size.icon.phone + space[2]}
											name={who ?? ""}
											seed={participantKey(s.payer)}
										/>
										<View style={{ flex: 1 }}>
											<Text
												style={{ color: color.fg, fontSize: type.body.size }}
											>
												{t("shareTitle")}
											</Text>
											<Text
												style={{ color: color.fg2, fontSize: type.small.size }}
											>
												{who
													? `${t("paidBy", { name: who })}, ${day(s.date)}`
													: day(s.date)}
											</Text>
										</View>
										<Text
											style={{
												color: color.fg,
												fontSize: type.body.size,
												fontVariant: ["tabular-nums"],
											}}
										>
											{s.amount ? money(s.amount) : t("noRate")}
										</Text>
									</ListRow>
								);
							})}
						</View>
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}
