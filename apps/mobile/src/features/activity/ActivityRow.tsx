import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { Glyph } from "@/ui/Glyph";
import { CategoryTile, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { StatusText } from "@/ui/StatusText";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import type { RowActions } from "./rowActions";
import type { ActivityItem } from "./source";

type Words = ReturnType<typeof useTranslations<"mobile.activity">>;

/** The row's headline: payments have no title, so they say who paid whom. */
export function rowTitle(item: ActivityItem, t: Words): string {
	if (item.kind !== "payment" || !item.payment) return item.title;
	return item.payment.direction === "sent"
		? t("row.paymentSent", { name: item.payment.counterparty })
		: t("row.paymentReceived", { name: item.payment.counterparty });
}

/** A status is a word, never color alone (GUIDELINE §2.1). */
export function rowStatus(item: ActivityItem, t: Words): string | null {
	if (item.waiting === "review") return t("row.review");
	if (item.waiting === "rejected") return t("row.rejected");
	if (item.pending) return t("row.pending");
	return null;
}

/** The status as a dot and its word: attention needs you, muted is out of play, info is in flight. */
function RowStatus({ item, label }: { item: ActivityItem; label: string }) {
	const tone =
		item.waiting === "review"
			? "attention"
			: item.waiting === "rejected"
				? "muted"
				: "info";
	return <StatusText label={label} size="sm" tone={tone} />;
}

function kindWord(item: ActivityItem, t: Words): string | null {
	switch (item.kind) {
		case "income":
			return t("row.income");
		case "refund":
			return t("row.refund");
		case "transfer":
			return t("row.transfer");
		default:
			return null;
	}
}

/**
 * The round mark at the start of a row while expenses are being selected. A
 * row that cannot join (a split, a payment, money in) shows an empty mark in
 * the muted line color, and the row says so to a screen reader.
 */
function PickMark({
	checked,
	enabled,
}: {
	checked: boolean;
	enabled: boolean;
}) {
	const { color, radius, size } = useTheme();
	return (
		<View
			style={{
				width: size.avatar.sm,
				height: size.avatar.sm,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: radius.chip,
				borderWidth: 1,
				borderColor: checked
					? color.brand
					: enabled
						? color.lineStrong
						: color.line,
				backgroundColor: checked ? color.brand : undefined,
			}}
		>
			{checked ? (
				<Glyph color={color.brandFg} name="Check" size={size.icon.phone} />
			) : null}
		</View>
	);
}

/** Money that is not spending: a payment or a transfer reads muted. */
const MUTED_KINDS = ["payment", "transfer"];

/** The first word of a name: "Lucía paid" reads better than a full name. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The entry row (the mockup's): category tile, the title (500) over a sub
 * line of status dot and word, kind, category and, on a split, the faces of
 * everyone on it with the payer ringed and "Lucía paid"; the amount on the
 * right in its own currency with the home value, or your share, under it.
 * Payments and transfers are muted, money in is positive. With `actions` the
 * row swipes and a long press opens the same actions as a menu.
 */
export function ActivityRow({
	item,
	onPress,
	selected,
	pick,
	actions,
}: {
	item: ActivityItem;
	onPress?: () => void;
	selected?: boolean;
	/** Set while expenses are being selected: whether this one is, and whether it can be. */
	pick?: { checked: boolean; enabled: boolean };
	actions?: RowActions;
}) {
	const t = useTranslations("mobile.activity");
	const tm = useTranslations("mobile.money");
	const { space } = useTheme();
	const format = useMoneyText();
	const faces = useFaces();
	const status = rowStatus(item, t);
	const title = rowTitle(item, t);
	const people = item.people ?? [];
	const shared = people.length > 1;
	const payer =
		shared && item.payerId
			? people.find((p) => p.id === item.payerId && !p.isSelf)
			: undefined;
	const paid = payer ? t("row.paid", { name: firstName(payer.name) }) : null;
	const income = item.kind === "income" || item.kind === "refund";
	const muted = MUTED_KINDS.includes(item.kind);
	const share = item.share ? format(item.share) : null;
	const kind = kindWord(item, t);

	// The sub line's parts, in the mockup's order, each a short piece.
	const parts: ReactNode[] = [];
	if (status) {
		parts.push(<RowStatus item={item} key="status" label={status} />);
	}
	for (const word of [kind, item.category?.name ?? null]) {
		if (word) {
			parts.push(
				<Text
					key={word}
					numberOfLines={1}
					style={{ flexShrink: 1 }}
					tone="fg3"
					variant="meta"
				>
					{word}
				</Text>,
			);
		}
	}
	if (shared) {
		parts.push(
			<View
				key="people"
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				<AvatarStack
					faces={faces(
						people.map((p) => ({
							key: p.id,
							name: p.name,
							imageUrl: p.imageUrl,
						})),
					)}
					max={3}
					payerKey={payer?.id}
					ring="surface"
					size="xs"
				/>
				{paid ? (
					<Text numberOfLines={1} tone="fg3" variant="meta">
						{paid}
					</Text>
				) : null}
			</View>,
		);
	} else if (item.project) {
		parts.push(
			<Text
				key="project"
				numberOfLines={1}
				style={{ flexShrink: 1 }}
				tone="fg3"
				variant="meta"
			>
				{item.project.name}
			</Text>,
		);
	}

	const sub =
		parts.length > 0 ? (
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[1],
					overflow: "hidden",
				}}
			>
				{parts.flatMap((part, index) =>
					index === 0
						? [part]
						: [
								<Text
									accessibilityElementsHidden
									importantForAccessibility="no"
									key={`dot-${(part as { key?: string }).key}`}
									tone="fg3"
									variant="meta"
								>
									{"·"}
								</Text>,
								part,
							],
				)}
			</View>
		) : undefined;

	const swipes = actions !== undefined && actions.menu.length > 0 && !pick;
	const row = (
		<ListRow
			accessibilityLabel={[
				title,
				status,
				kind,
				item.category?.name,
				shared ? people.map((p) => p.name).join(", ") : item.project?.name,
				paid,
				format(item.amount),
				item.home
					? format(item.home)
					: item.home === null
						? tm("noRate")
						: null,
				share ? tm("yourShare", { amount: share }) : null,
			]
				.filter(Boolean)
				.join(", ")}
			end={
				<View style={{ alignItems: "flex-end" }}>
					<MoneyAmount
						home={item.home}
						rateType={item.rateType}
						sign={income ? "exceptZero" : "auto"}
						tone={income ? "positive" : muted ? "muted" : "default"}
						value={item.amount}
					/>
					{share ? (
						<Text numberOfLines={1} tabular tone="fg3" variant="meta">
							{tm("yourShare", { amount: share })}
						</Text>
					) : null}
				</View>
			}
			lead={
				<>
					{pick ? (
						<PickMark checked={pick.checked} enabled={pick.enabled} />
					) : null}
					<CategoryTile
						category={item.category}
						fallback={item.kind === "payment" ? "Banknote" : "Tag"}
					/>
				</>
			}
			// A swiping row hands its tap to the swipe wrapper, which also
			// owns the long press; a disabled inner press lets both through.
			onPress={swipes ? undefined : onPress}
			pickState={pick}
			selected={pick ? pick.checked : selected}
			sub={sub}
			title={title}
		/>
	);
	if (!swipes || !actions) return row;
	return (
		<SwipeRow
			leading={actions.leading}
			menu={actions.menu}
			menuTitle={title}
			onPress={onPress}
			trailing={actions.trailing}
		>
			{row}
		</SwipeRow>
	);
}
