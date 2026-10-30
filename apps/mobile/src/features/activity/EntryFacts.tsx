import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { CategoryGlyph, categoryColor, Glyph } from "@/ui/Glyph";
import { useRateTypeLabel } from "@/ui/Money";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { rowStatus } from "./ActivityRow";
import type { ActivityItem } from "./source";
import type { ExpenseDetail } from "./useEntryDetail";

/**
 * A label on the left, its value (600) on the right; a missing value leaves
 * no row. With `onPress` the row is a link: it ends in a chevron and opens
 * what changes the value.
 */
function Fact({
	label,
	children,
	onPress,
	hint,
}: {
	label: string;
	children: ReactNode | null | undefined | false;
	onPress?: () => void;
	hint?: string;
}) {
	const { color, size, space } = useTheme();
	if (children === null || children === undefined || children === false) {
		return null;
	}
	return (
		<Pressable
			accessibilityHint={onPress ? hint : undefined}
			accessibilityRole={onPress ? "button" : undefined}
			disabled={!onPress}
			onPress={onPress}
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
			<Text tone="fg2">{label}</Text>
			<View
				style={{
					flex: 1,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "flex-end",
					gap: space[2],
				}}
			>
				{typeof children === "string" ? (
					<Text
						numberOfLines={2}
						style={{ textAlign: "right" }}
						weight="semibold"
					>
						{children}
					</Text>
				) : (
					children
				)}
				{onPress ? (
					<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
				) : null}
			</View>
		</Pressable>
	);
}

/** Time of day is not shown; the server sends days. */
function dayDate(day: string): Date {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d, 12);
}

/**
 * The facts under the head, in the mockup's order: Paid by (a face), Date,
 * Rate, Project, Category, Your share, State, then what only some entries have
 * (spread, hidden from reports, place). What the list row has comes first; a
 * personal expense adds its own from the server's detail.
 */
export function EntryFacts({
	item,
	extra,
	onCategory,
}: {
	item: ActivityItem;
	extra: ExpenseDetail | null;
	/** Opens the category picker; absent where the entry's category is not yours to change. */
	onCategory?: () => void;
}) {
	const t = useTranslations("mobile.entry");
	const ta = useTranslations("mobile.activity");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const faces = useFaces();
	const rateName = useRateTypeLabel();
	const { state: session } = useSession();
	const { color, size, space } = useTheme();
	const me = session.status === "signedIn" ? session.me : null;

	const people = item.people ?? [];
	const payer = item.payerId
		? people.find((p) => p.id === item.payerId)
		: undefined;
	const payerFace = payer
		? faces([{ key: payer.id, name: payer.name, imageUrl: payer.imageUrl }])[0]
		: me && item.kind === "expense"
			? faces([
					{
						key: `user:${me.id}`,
						name: me.name,
						imageUrl: me.avatarUrl ?? me.image ?? null,
					},
				])[0]
			: undefined;
	const paidBy = payer
		? payer.isSelf
			? t("you")
			: payer.name
		: item.payerId
			? item.payerId === `user:${me?.id}`
				? t("you")
				: (item.payerName ?? null)
			: payerFace
				? t("you")
				: null;
	const rate = item.rateType ?? extra?.rateType;
	const foreign = item.home !== undefined;
	const status = rowStatus(item, ta);
	const category = item.category;
	const categoryName =
		category?.name ?? (item.kind === "expense" ? t("uncategorized") : null);
	const split = people.length > 1;

	return (
		<View>
			<Fact label={t("paidBy")}>
				{paidBy ? (
					<>
						{payerFace ? <Avatar face={payerFace} size="xs" /> : null}
						<Text weight="semibold">{paidBy}</Text>
					</>
				) : null}
			</Fact>
			<Fact label={t("date")}>
				{format.dateTime(dayDate(item.date), { dateStyle: "long" })}
			</Fact>
			<Fact label={t("rate")}>
				{foreign
					? item.home === null
						? tm("noRate")
						: rate
							? rateName(rate)
							: null
					: null}
			</Fact>
			<Fact label={t("project")}>{item.project?.name}</Fact>
			<Fact
				hint={t("changeCategory")}
				label={t("category")}
				onPress={onCategory}
			>
				{categoryName ? (
					<>
						{category?.name ? (
							<CategoryGlyph
								category={{ name: category.name, icon: category.icon }}
								color={categoryColor(color, category.tone)}
								size={size.icon.phone}
							/>
						) : null}
						<Text weight="semibold">{categoryName}</Text>
					</>
				) : null}
			</Fact>
			<Fact label={t("yourShare")}>
				{split && item.share ? (
					<Text tabular weight="semibold">
						{money(item.share)}
					</Text>
				) : null}
			</Fact>
			<Fact label={t("status")}>
				{status ? (
					<StatusText
						label={status}
						tone={
							item.waiting === "review"
								? "attention"
								: item.waiting === "rejected"
									? "muted"
									: "info"
						}
					/>
				) : item.locked ? (
					t("locked")
				) : null}
			</Fact>
			<Fact label={t("spread")}>
				{extra?.amortizeOver
					? t("spreadMonths", { months: extra.amortizeOver })
					: null}
			</Fact>
			<Fact label={t("reports")}>
				{extra?.excludeFromAnalytics ? t("hidden") : null}
			</Fact>
			<Fact label={t("location")}>{extra?.location}</Fact>
			{/* The gap under the last hairline keeps the shares list apart. */}
			<View style={{ height: space[2] }} />
		</View>
	);
}
