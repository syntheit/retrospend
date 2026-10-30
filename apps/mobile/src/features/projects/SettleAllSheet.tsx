import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { PreviewList } from "@/features/settle/PreviewList";
import type { PaymentPreview } from "@/features/settle/plan";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
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
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
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
		<Text tone={tone === "attention" ? "attention" : "fg2"}>{text}</Text>
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
			footer={
				flow.plan !== null && !nothing && flow.status === "ready" ? (
					<>
						<Button label={tc("cancel")} onPress={onClose} variant="text" />
						<Button
							disabled={
								!flow.preview || flow.recording || willRecord.length === 0
							}
							label={flow.recording ? t("recording") : t("record")}
							onPress={record}
						/>
					</>
				) : undefined
			}
			onClose={onClose}
			title={t("title", { name: projectName })}
			visible={visible}
		>
			<View style={{ ...body }}>
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
										tone="fg2"
										variant="small"
										weight="semibold"
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
												style={{ gap: space[1] }}
											>
												<View
													style={{
														flexDirection: "row",
														justifyContent: "space-between",
														gap: space[3],
													}}
												>
													<Text style={{ flexShrink: 1 }}>{words}</Text>
													<Text tabular weight="medium">
														{amount}
													</Text>
												</View>
												{d.waiting ? (
													<Text tone="fg2" variant="small">
														{t("waiting", { name: who })}
													</Text>
												) : null}
											</View>
										);
									})}
									{skipped.map((line) => (
										<Text
											key={`${line.person}:${line.amount.currency}:${line.reason}`}
											tone="fg2"
											variant="small"
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
						</>
					)}
				</ScrollView>
			</View>
		</Sheet>
	);
}
