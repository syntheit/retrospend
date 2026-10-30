import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/ui/Money";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow, SectionHeader, StaleNote } from "@/ui/List";
import { Text } from "@/ui/Text";
import type { ProjectSummary } from "./source";

type SummaryMember = ProjectSummary["members"][number];
type Line = SummaryMember["lines"][number];

/** One member's figures in the project: paid, share and the balance per currency. */
function MemberRow({ member }: { member: SummaryMember }) {
	const t = useTranslations("mobile.projects.summary");
	const money = useMoneyText();
	const faces = useFaces();
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
		<ListRow
			accessibilityLabel={spoken}
			end={
				lines.length === 0 ? (
					<Text tone="fg2" variant="small">
						{t("even")}
					</Text>
				) : (
					<View style={{ alignItems: "flex-end" }}>
						{lines.map((line) => (
							<View key={line.currency} style={{ alignItems: "flex-end" }}>
								<Text
									tone={line.balance.minor > 0 ? "positive" : "fg2"}
									variant="meta"
								>
									{line.balance.minor > 0 ? t("isOwedShort") : t("owesShort")}
								</Text>
								<MoneyAmount
									strong
									tone={line.balance.minor > 0 ? "positive" : "default"}
									value={{
										minor: Math.abs(line.balance.minor),
										currency: line.balance.currency,
									}}
								/>
							</View>
						))}
					</View>
				)
			}
			lead={face ? <Avatar face={face} size="row" /> : null}
			sub={
				<View>
					{member.lines.map((line) => (
						<Text
							key={line.currency}
							numberOfLines={1}
							tone="fg3"
							variant="meta"
						>
							{detail(line)}
						</Text>
					))}
					{member.isMember ? null : (
						<Text tone="fg3" variant="meta">
							{t("left")}
						</Text>
					)}
				</View>
			}
			title={member.name}
		/>
	);
}

/**
 * The Summary tab: Settle all (recording the fewest payments), the group
 * total, every member's Paid, Share and balance per currency (never netted
 * across currencies), and the fewest transfers that would settle it
 * (display only; recording is Settle all).
 */
export function ProjectSummaryTab({
	state,
	onSettleAll,
}: {
	state:
		| { status: "loading" }
		| { status: "error" }
		| { status: "ready"; data: ProjectSummary; staleSince: string | null };
	/** Present when you may record payments; the Settle all button opens its sheet. */
	onSettleAll?: () => void;
}) {
	const t = useTranslations("mobile.projects.summary");
	const ts = useTranslations("mobile.projects.settleAll");
	const money = useMoneyText();
	const { size, space } = useTheme();
	if (state.status === "loading") return null;
	if (state.status === "error") {
		return <EmptyState detail={t("errorDetail")} title={t("error")} />;
	}
	const summary = state.data;
	return (
		<View>
			<StaleNote since={state.staleSince} />
			{onSettleAll ? (
				<View
					style={{
						alignItems: "flex-start",
						paddingHorizontal: size.gutter.phone,
						paddingTop: space[4],
					}}
				>
					<Button label={ts("open")} onPress={onSettleAll} />
				</View>
			) : null}
			{summary.balancesAddUp ? null : (
				<Text
					style={{
						paddingHorizontal: size.gutter.phone,
						paddingTop: space[2],
					}}
					tone="attention"
				>
					{t("imbalance", {
						amounts: summary.imbalance.map((m) => money(m)).join(", "),
					})}
				</Text>
			)}
			<SectionHeader title={t("members")} />
			<ListGroup>
				{summary.members.map((member) => (
					<MemberRow key={member.key} member={member} />
				))}
			</ListGroup>
			{summary.transfers.length > 0 ? (
				<>
					<SectionHeader title={t("transfers")} />
					<Text
						style={{
							paddingHorizontal: size.gutter.phone,
							paddingBottom: space[2],
						}}
						tone="fg2"
						variant="small"
					>
						{t("transfersNote")}
					</Text>
					<ListGroup>
						{summary.transfers.map((transfer) => (
							<ListRow
								accessibilityLabel={`${t("pays", { from: transfer.from.name, to: transfer.to.name })}, ${money(transfer.amount)}`}
								end={<MoneyAmount value={transfer.amount} />}
								key={`${transfer.from.key}>${transfer.to.key}:${transfer.amount.currency}`}
								title={t("pays", {
									from: transfer.from.name,
									to: transfer.to.name,
								})}
							/>
						))}
					</ListGroup>
				</>
			) : null}
		</View>
	);
}
