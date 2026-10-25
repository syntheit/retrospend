import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { PreviewList } from "@/features/settle/PreviewList";
import type { PaymentPreview } from "@/features/settle/plan";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import { describeLine, nameOfKey, settleAllDetailOf } from "./settleAll";
import type { ProjectPage } from "./source";
import { useSettleAll } from "./useSettleAll";

/**
 * Settle all in a project: every open balance you have with the others,
 * one payment per person and currency, never converted. The sheet lists
 * exactly the payments the server's dry run says it will write, then ends
 * with a toast that takes them all back (R15, R30).
 */
export function SettleAllSheet({
	projectId,
	projectName,
	members,
	visible,
	onClose,
	onDone,
}: {
	projectId: string;
	projectName: string;
	members: ProjectPage["members"];
	visible: boolean;
	onClose: () => void;
	/** The payments were written (or taken back): the page behind refreshes. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.projects.settleAll");
	const tc = useTranslations("mobile.common");
	const toast = useToast();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const flow = useSettleAll(projectId, visible);
	const nameOf = (key: string) => nameOfKey(members, key);
	const first = (key: string) => nameOf(key).split(/\s+/)[0] ?? nameOf(key);
	const nothing = flow.plan !== null && flow.plan.planned.length === 0;

	async function record() {
		const done = await flow.record();
		if (!done) return;
		onClose();
		onDone();
		toast.show({
			message: t("recorded", { count: done.settled.length }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const undone = await flow.undo(done.undo);
					toast.show({ message: undone ? t("undone") : t("undoError") });
					if (undone) onDone();
				},
			},
		});
	}

	const note = (text: string, tone: "plain" | "attention" = "plain") => (
		<Text
			style={{
				color: tone === "attention" ? color.attentionText : color.fg2,
				fontSize: type.body.size,
			}}
		>
			{text}
		</Text>
	);

	// The figures this write moves for the whole project, not one person.
	const figures: PaymentPreview | null = flow.preview
		? {
				...flow.preview,
				changes: flow.preview.changes.filter((c) => c.id.startsWith("owed.")),
				unchanged: flow.preview.unchanged.filter((u) =>
					u.id.startsWith("owed."),
				),
			}
		: null;
	const { willRecord, skipped } = settleAllDetailOf(flow.preview);

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title", { name: projectName })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
			>
				{flow.status === "loadError" ? (
					<>
						{note(t("loadError"), "attention")}
						<Button
							label={tc("retry")}
							onPress={flow.retryLoad}
							variant="outlined"
						/>
					</>
				) : nothing ? (
					note(t("nothing"))
				) : flow.plan === null || flow.status === "loading" ? (
					note(t("checking"))
				) : (
					<>
						{note(t("explain"))}
						{flow.preview ? (
							<View style={{ gap: space[2] }}>
								<Text
									accessibilityRole="header"
									style={{
										color: color.fg2,
										fontSize: type.small.size,
										fontWeight: "600",
									}}
								>
									{t("willRecord")}
								</Text>
								{willRecord.map((line) => {
									const d = describeLine(line, nameOf);
									const who = first(line.person);
									const words =
										d.direction === "outgoing"
											? t("youPay", { name: who })
											: t("paidYou", { name: who });
									const amount = money(line.amount);
									return (
										<View
											accessibilityLabel={`${words} ${amount}${d.waiting ? `, ${t("waiting", { name: who })}` : ""}`}
											accessible
											key={d.key}
											style={{ gap: 2 }}
										>
											<View
												style={{
													flexDirection: "row",
													justifyContent: "space-between",
													gap: space[3],
												}}
											>
												<Text
													style={{
														flexShrink: 1,
														color: color.fg,
														fontSize: type.body.size,
													}}
												>
													{words}
												</Text>
												<Text
													style={{
														color: color.fg,
														fontSize: type.body.size,
														fontVariant: ["tabular-nums"],
														fontWeight: "500",
													}}
												>
													{amount}
												</Text>
											</View>
											{d.waiting ? (
												<Text
													style={{
														color: color.fg2,
														fontSize: type.small.size,
													}}
												>
													{t("waiting", { name: who })}
												</Text>
											) : null}
										</View>
									);
								})}
								{skipped.map((line) => (
									<Text
										key={`${line.person}:${line.amount.currency}:${line.reason}`}
										style={{
											color: color.fg2,
											fontSize: type.small.size,
										}}
									>
										{t(`skipped.${line.reason}`, {
											name: first(line.person),
											amount: money(line.amount),
										})}
									</Text>
								))}
							</View>
						) : flow.previewFailed ? (
							note(t("previewError"), "attention")
						) : (
							note(t("checking"))
						)}
						{figures ? <PreviewList name="" preview={figures} /> : null}
						{flow.recordFailed === "moved"
							? note(t("moved"), "attention")
							: flow.recordFailed === "error"
								? note(t("error"), "attention")
								: null}
						<Button
							disabled={
								!flow.preview || flow.recording || willRecord.length === 0
							}
							label={flow.recording ? t("recording") : t("record")}
							onPress={record}
						/>
					</>
				)}
			</ScrollView>
		</Sheet>
	);
}
