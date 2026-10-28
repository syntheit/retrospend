import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { LinkButton, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Note, SheetBody } from "./parts";
import { RuleAddForm } from "./RuleAddForm";
import { applyRuleBody, movedIds, type Rule } from "./rulesBody";
import { type BudgetMonth, envelopeById } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { noSession, useApi } from "./WriteFrame";
import { WriteForm } from "./WriteSheet";

type Mode =
	| { kind: "list" }
	| { kind: "add" }
	| { kind: "rule"; id: string }
	| { kind: "apply"; id: string };

/** A rule in one sentence: the server's own amounts and percentages, worded. */
export function useRuleSentence(data: BudgetMonth) {
	const t = useTranslations("mobile.budget.rules.sentence");
	const money = useMoneyText();
	const format = useFormatter();
	return (rule: Rule): string => {
		const name =
			envelopeById(data, rule.envelopeId)?.name ?? t("envelopeFallback");
		const a = rule.action;
		if (a.kind === "PERCENT" && a.basisPoints !== null) {
			return t("percent", {
				percent: format.number(a.basisPoints / 10_000, {
					style: "percent",
					maximumFractionDigits: 2,
				}),
				name,
			});
		}
		if (a.kind === "AMOUNT" && a.amount) {
			return t("amount", { amount: money(a.amount), name });
		}
		return t("rest", { name });
	};
}

/**
 * Income rules: what happens when money arrives, in the order the rules run.
 * Pausing, moving or removing a rule never touches money already assigned, so
 * those write at once. Applying a rule to this month's money in does move
 * money: it is previewed and ends in an Undo toast.
 */
export function RulesSheet({
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
	const t = useTranslations("mobile.budget.rules");
	const { color, space, type } = useTheme();
	const sentence = useRuleSentence(data);
	const [mode, setMode] = useState<Mode>({ kind: "list" });
	const [failed, setFailed] = useState(false);
	const read = useSheetRead(visible, (client) => client.budget.rules());
	const rules = read.status === "ready" ? read.data : [];
	const session = useApi();
	const api = () => session ?? noSession();
	const current =
		mode.kind === "rule" || mode.kind === "apply"
			? (rules.find((r) => r.id === mode.id) ?? null)
			: null;
	const index = current ? rules.findIndex((r) => r.id === current.id) : -1;
	const { idFor, reset } = useWriteIds(
		visible && mode.kind === "apply" ? mode.id : null,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts at the list
	useEffect(() => {
		if (!visible) return;
		reset();
		setMode({ kind: "list" });
		setFailed(false);
	}, [visible]);

	async function change(run: () => Promise<unknown>) {
		setFailed(false);
		try {
			await run();
			read.reload();
			setMode({ kind: "list" });
		} catch {
			setFailed(true);
		}
	}

	const back = (
		<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
			<LinkButton label={t("back")} onPress={() => setMode({ kind: "list" })} />
		</View>
	);
	const title =
		mode.kind === "add"
			? t("editor.title")
			: current
				? current.name
				: t("title");

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={title}
			visible={visible}
		>
			<SheetBody>
				{mode.kind === "add" ? (
					<>
						{back}
						<RuleAddForm
							data={data}
							onAdded={() => read.reload()}
							onClose={() => setMode({ kind: "list" })}
						/>
					</>
				) : mode.kind === "apply" && current ? (
					<>
						{back}
						<WriteForm
							active={visible}
							data={data}
							idempotencyKey={idFor("apply")}
							input={applyRuleBody({
								batchId: idFor("apply"),
								ruleId: current.id,
							})}
							message={t("apply.toast", { name: current.name })}
							onClose={() => setMode({ kind: "list" })}
							onDone={onDone}
							preview={(client, body) => client.budget.previewApplyRule(body)}
							submitLabel={t("apply.apply")}
							write={(client, body, key) =>
								client.budget.applyRule(body, {
									context: { idempotencyKey: key },
								})
							}
						>
							<Note>{t("apply.lead")}</Note>
						</WriteForm>
					</>
				) : mode.kind === "rule" && current ? (
					<>
						{back}
						<Note>{sentence(current)}</Note>
						{failed ? <Note tone="attention">{t("error")}</Note> : null}
						<Button
							label={current.active ? t("pause") : t("resume")}
							onPress={() =>
								void change(() =>
									api().budget.updateRule({
										id: current.id,
										active: !current.active,
									}),
								)
							}
						/>
						<Button
							disabled={index <= 0}
							label={t("moveUp")}
							onPress={() => {
								const ids = movedIds(
									rules.map((r) => r.id),
									index,
									-1,
								);
								if (ids) void change(() => api().budget.reorderRules({ ids }));
							}}
							variant="outlined"
						/>
						<Button
							disabled={index < 0 || index >= rules.length - 1}
							label={t("moveDown")}
							onPress={() => {
								const ids = movedIds(
									rules.map((r) => r.id),
									index,
									1,
								);
								if (ids) void change(() => api().budget.reorderRules({ ids }));
							}}
							variant="outlined"
						/>
						<Button
							label={t("applyAction")}
							onPress={() => setMode({ kind: "apply", id: current.id })}
							variant="outlined"
						/>
						<Button
							label={t("remove")}
							onPress={() =>
								void change(() => api().budget.archiveRule({ id: current.id }))
							}
							variant="text"
						/>
					</>
				) : (
					<>
						<Note>{t("lead")}</Note>
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						{read.status === "ready" && rules.length === 0 ? (
							<Note>{t("none")}</Note>
						) : null}
						<View>
							{rules.map((r) => (
								<ListRow
									accessibilityLabel={`${r.name}, ${sentence(r)}`}
									key={r.id}
									onPress={() => setMode({ kind: "rule", id: r.id })}
								>
									<View style={{ flex: 1 }}>
										<Text style={{ color: color.fg, fontSize: type.body.size }}>
											{r.name}
										</Text>
										<Text
											style={{ color: color.fg2, fontSize: type.small.size }}
										>
											{r.active
												? sentence(r)
												: `${sentence(r)}. ${t("paused")}`}
										</Text>
									</View>
								</ListRow>
							))}
						</View>
						<Button
							label={t("add")}
							onPress={() => setMode({ kind: "add" })}
							variant="outlined"
						/>
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}
