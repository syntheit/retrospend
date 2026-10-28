import { useMemo } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useFaces } from "@/features/read/faces";
import { ENTITY_CACHE_LIMIT } from "@/features/read/loadCached";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { StaleNote } from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { rowStatus, rowTitle } from "./ActivityRow";
import type { ActivityItem } from "./source";
import { TextAction } from "./TextAction";

/**
 * Only your own plain expenses can be edited here: a split, a payment, money
 * in and a transfer have no edit route in API v1 yet, and a locked entry is
 * the server's to refuse.
 */
export function canEditEntry(item: ActivityItem): boolean {
	return (
		item.source === "personal" &&
		item.kind === "expense" &&
		item.canEdit &&
		!item.locked
	);
}

/** A label on the left, its value on the right; a missing value leaves no row. */
function Fact({
	label,
	value,
}: {
	label: string;
	value: string | null | undefined;
}) {
	const { color, size, space, type } = useTheme();
	if (!value) return null;
	return (
		<View
			style={{
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[4],
				paddingVertical: space[2],
				borderBottomWidth: 1,
				borderBottomColor: color.line,
			}}
		>
			<Text style={{ color: color.fg2, fontSize: type.body.size }}>
				{label}
			</Text>
			<Text
				style={{
					flex: 1,
					color: color.fg,
					fontSize: type.body.size,
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</View>
	);
}

/** Time of day is not shown; the server sends days. */
function dayDate(day: string): Date {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d, 12);
}

/**
 * The read view of one entry: what it is, the amount in its own currency
 * with the home value under it, and the facts the list does not have room
 * for. A personal expense also reads its notes, place and spread from
 * GET /expenses/{id}; a split and a payment show what the list row carries.
 */
export function EntryView({ item }: { item: ActivityItem }) {
	const t = useTranslations("mobile.entry");
	const ta = useTranslations("mobile.activity");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const faces = useFaces();
	const { api, state: session } = useSession();
	const { color, size, space, type } = useTheme();
	const me = session.status === "signedIn" ? session.me : null;
	const add = useOptionalAddEntry();

	const personal = item.source === "personal";
	const fetch = useMemo(
		() =>
			api && personal ? () => api.expenses.get({ id: item.entityId }) : null,
		[api, personal, item.entityId],
	);
	const detail = useCachedRead(
		personal ? { name: `expense.${item.entityId}`, schema: 1 } : null,
		fetch,
		{ prefix: "expense.", keep: ENTITY_CACHE_LIMIT },
	);
	const extra = detail.state.status === "ready" ? detail.state.data : null;

	const title = rowTitle(item, ta);
	const status = rowStatus(item, ta);
	const others = (item.people ?? []).filter((p) => !p.isSelf);
	const income = item.kind === "income" || item.kind === "refund";
	const paidBy = item.payerId
		? item.payerId === `user:${me?.id}`
			? t("you")
			: item.payerName
		: null;
	const rate = item.rateType ?? extra?.rateType;

	return (
		<View style={{ paddingBottom: space[8] }}>
			<View style={{ gap: space[2], paddingVertical: space[2] }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						gap: space[3],
					}}
				>
					<Text
						accessibilityRole="header"
						style={{
							flex: 1,
							color: color.fg,
							fontSize: type.title.size,
							fontWeight: "600",
						}}
					>
						{title}
					</Text>
					{add && canEditEntry(item) ? (
						<TextAction
							label={t("edit")}
							onPress={() => add.edit(item.entityId)}
						/>
					) : null}
				</View>
				<MoneyAmount
					align="left"
					home={item.home}
					rateType={item.rateType}
					sign={income ? "exceptZero" : "auto"}
					size="hero"
					tone={income ? "positive" : "default"}
					value={item.amount}
				/>
				{item.share ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{tm("yourShare", { amount: money(item.share) })}
					</Text>
				) : null}
				{status ? (
					<Text
						style={{
							color: color.attentionText,
							fontSize: type.body.size,
							fontWeight: "500",
						}}
					>
						{status}
					</Text>
				) : null}
			</View>
			<View>
				<Fact
					label={t("date")}
					value={format.dateTime(dayDate(item.date), { dateStyle: "full" })}
				/>
				<Fact label={t("type")} value={t(`kind.${item.kind}`)} />
				<Fact
					label={t("category")}
					value={
						item.category?.name ??
						(item.kind === "expense" ? t("uncategorized") : null)
					}
				/>
				<Fact label={t("project")} value={item.project?.name} />
				<Fact label={t("paidBy")} value={paidBy} />
				{others.length > 0 ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
							minHeight: size.row.phone,
							paddingVertical: space[2],
							borderBottomWidth: 1,
							borderBottomColor: color.line,
							gap: space[4],
						}}
					>
						<Text style={{ color: color.fg2, fontSize: type.body.size }}>
							{t("people")}
						</Text>
						<AvatarStack
							faces={faces(
								others.map((p) => ({
									key: p.id,
									name: p.name,
									imageUrl: p.imageUrl,
								})),
							)}
							size="default"
						/>
						<Text
							numberOfLines={2}
							style={{
								flex: 1,
								color: color.fg,
								fontSize: type.body.size,
								textAlign: "right",
							}}
						>
							{others.map((p) => p.name).join(", ")}
						</Text>
					</View>
				) : null}
				<Fact label={t("rate")} value={rate ? t("rateType", { rate }) : null} />
				<Fact label={t("location")} value={extra?.location} />
				<Fact label={t("notes")} value={extra?.description} />
				<Fact
					label={t("spread")}
					value={
						extra?.amortizeOver
							? t("spreadMonths", { months: extra.amortizeOver })
							: null
					}
				/>
				<Fact
					label={t("excluded")}
					value={extra?.excludeFromAnalytics ? t("yes") : null}
				/>
				<Fact label={t("status")} value={item.locked ? t("locked") : null} />
				<Fact
					label={t("added")}
					value={
						extra
							? format.dateTime(new Date(extra.createdAt), {
									dateStyle: "medium",
								})
							: null
					}
				/>
			</View>
			<StaleNote
				since={detail.state.status === "ready" ? detail.state.staleSince : null}
			/>
		</View>
	);
}
