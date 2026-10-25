import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { ListRow, SectionHeader, StaleNote } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import type { ProjectSummary } from "./source";

type SummaryMember = ProjectSummary["members"][number];
type Line = SummaryMember["lines"][number];

/** One member's figures in the project: paid, share and the balance per currency. */
function MemberRow({ member }: { member: SummaryMember }) {
	const t = useTranslations("mobile.projects.summary");
	const money = useMoneyText();
	const faces = useFaces();
	const { color, type } = useTheme();
	const [face] = faces([member]);
	const lines = member.lines.filter((l) => l.balance.minor !== 0);
	const balanceWords = (line: Line) =>
		line.balance.minor > 0
			? t("isOwed", { amount: money(line.balance) })
			: t("owes", {
					amount: money({
						minor: -line.balance.minor,
						currency: line.balance.currency,
					}),
				});
	const detail = (line: Line) =>
		t("paidShare", { paid: money(line.paid), share: money(line.share) });
	const spoken = [
		member.name,
		...member.lines.map((l) => `${detail(l)}, ${balanceWords(l)}`),
		member.isMember ? null : t("left"),
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ListRow accessibilityLabel={spoken}>
			{face ? <Avatar face={face} size="md" /> : null}
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{member.name}
				</Text>
				{member.lines.map((line) => (
					<Text
						key={line.currency}
						numberOfLines={1}
						style={{ color: color.fg2, fontSize: type.small.size }}
					>
						{detail(line)}
					</Text>
				))}
				{member.isMember ? null : (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("left")}
					</Text>
				)}
			</View>
			<View style={{ alignItems: "flex-end", gap: 2 }}>
				{lines.length === 0 ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("even")}
					</Text>
				) : (
					lines.map((line) => (
						<View key={line.currency} style={{ alignItems: "flex-end" }}>
							<Text style={{ color: color.fg2, fontSize: type.small.size }}>
								{line.balance.minor > 0 ? t("isOwedShort") : t("owesShort")}
							</Text>
							<MoneyAmount
								tone={line.balance.minor > 0 ? "positive" : "default"}
								value={{
									minor: Math.abs(line.balance.minor),
									currency: line.balance.currency,
								}}
							/>
						</View>
					))
				)}
			</View>
		</ListRow>
	);
}

/**
 * The Summary tab: the group total, every member's Paid, Share and balance
 * per currency (never netted across currencies), and the fewest transfers
 * that would settle it (display only; recording is Settle all).
 */
export function ProjectSummaryTab({
	state,
}: {
	state:
		| { status: "loading" }
		| { status: "error" }
		| { status: "ready"; data: ProjectSummary; staleSince: string | null };
}) {
	const t = useTranslations("mobile.projects.summary");
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	if (state.status === "loading") return null;
	if (state.status === "error") {
		return <EmptyState detail={t("errorDetail")} title={t("error")} />;
	}
	const summary = state.data;
	return (
		<View>
			<StaleNote since={state.staleSince} />
			{summary.balancesAddUp ? null : (
				<Text
					style={{
						color: color.attentionText,
						fontSize: type.body.size,
						paddingHorizontal: space[4],
						paddingTop: space[2],
					}}
				>
					{t("imbalance", {
						amounts: summary.imbalance.map((m) => money(m)).join(", "),
					})}
				</Text>
			)}
			<SectionHeader title={t("members")} />
			{summary.members.map((member) => (
				<MemberRow key={member.key} member={member} />
			))}
			{summary.transfers.length > 0 ? (
				<>
					<SectionHeader title={t("transfers")} />
					<Text
						style={{
							color: color.fg2,
							fontSize: type.small.size,
							paddingHorizontal: space[4],
							paddingBottom: space[2],
						}}
					>
						{t("transfersNote")}
					</Text>
					{summary.transfers.map((transfer) => (
						<ListRow
							accessibilityLabel={`${t("pays", { from: transfer.from.name, to: transfer.to.name })}, ${money(transfer.amount)}`}
							key={`${transfer.from.key}>${transfer.to.key}:${transfer.amount.currency}`}
						>
							<Text
								style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
							>
								{t("pays", { from: transfer.from.name, to: transfer.to.name })}
							</Text>
							<MoneyAmount value={transfer.amount} />
						</ListRow>
					))}
				</>
			) : null}
		</View>
	);
}
