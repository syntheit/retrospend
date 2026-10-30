import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Line, Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Picker } from "@/ui/Picker";
import type { SheetDetent } from "@/ui/Sheet";
import { FieldLabel } from "@/ui/TextField";
import { planBody, type RestChoice } from "./bodies";
import { monthDate } from "./months";
import { type BudgetMonth, envelopeById, type FillPlan } from "./source";
import { FormSheet, WriteForm } from "./WriteSheet";

/** Where the money for each job comes from: the first line that names the envelope. */
export function reasonOf(plan: FillPlan, envelopeId: string): string {
	return plan.lines.find((l) => l.envelopeId === envelopeId)?.step ?? "REST";
}

/**
 * Use my plan: the server's own fill (saved plan, then overspending, bills,
 * group targets, monthly targets, savings) of the money that is not planned
 * yet, shown before it is written, with a choice for what is left over. One
 * batch, one Undo.
 */
export function UsePlanSheet({
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
	const t = useTranslations("mobile.budget.usePlan");
	const tb = useTranslations("mobile.budget");
	const format = useFormatter();
	const api = useApi();
	const money = useMoneyText();
	const { space } = useTheme();
	const [plan, setPlan] = useState<FillPlan | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [rest, setRest] = useState<RestChoice>("LEAVE");

	useEffect(() => {
		if (!visible || !api) return;
		let cancelled = false;
		setPlan(null);
		setLoadFailed(false);
		setRest("LEAVE");
		api.budget
			.fillFromTargets({ month: data.month.key })
			.then((result) => !cancelled && setPlan(result))
			.catch(() => !cancelled && setLoadFailed(true));
		return () => {
			cancelled = true;
		};
	}, [visible, api, data.month.key]);

	const poolName = tb(`pool.${data.toAssign.poolName}`);
	const jobs = plan?.totals.filter((total) => total.amount.minor > 0) ?? [];
	const bodyKey = plan && jobs.length > 0 ? JSON.stringify({ rest }) : null;
	const { idFor, reset } = useWriteIds(bodyKey);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening is a new write
	useEffect(() => {
		if (visible) reset();
	}, [visible]);
	const input = bodyKey ? planBody({ batchId: idFor("batch"), rest }) : null;

	const restLabel = (option: FillPlan["restOptions"][number]) => {
		if (option.choice === "SAVE") {
			const name = envelopeById(data, option.envelopeId)?.name ?? "";
			return t("saveIt", { name });
		}
		if (option.choice === "NEXT_MONTH" && option.month !== null) {
			return t("nextMonth", {
				month: format.dateTime(monthDate(option.month), {
					month: "long",
					timeZone: "UTC",
				}),
			});
		}
		return t("leave");
	};

	return (
		<FormSheet
			detent={detent}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			{loadFailed ? (
				<Note tone="attention">{t("loadError")}</Note>
			) : !plan ? (
				<Note>{tb("preview.checking")}</Note>
			) : jobs.length === 0 ? (
				<Note>{t("met")}</Note>
			) : (
				<WriteForm
					active={visible}
					data={data}
					idempotencyKey={input?.batchId ?? null}
					input={input}
					message={(
						out: Awaited<ReturnType<RetrospendClient["budget"]["usePlan"]>>,
					) =>
						t("toast", {
							count: new Set(out.result.lines.map((l) => l.envelopeId)).size,
						})
					}
					onClose={onClose}
					onDone={onDone}
					preview={(client, body) => client.budget.previewUsePlan(body)}
					submitLabel={t("use")}
					write={(client, body, key) =>
						// biome-ignore lint/correctness/useHookAtTopLevel: `usePlan` is the API route's name, not a hook
						client.budget.usePlan(body, { context: { idempotencyKey: key } })
					}
				>
					<Note>{t("lead", { amount: money(plan.available) })}</Note>
					<View>
						{jobs.map((job) => {
							const name =
								envelopeById(data, job.envelopeId)?.name ??
								t("envelopeFallback");
							const why = t(
								`why.${reasonOf(plan, job.envelopeId)}` as "why.PLAN",
							);
							return (
								<Line
									key={job.envelopeId}
									label={`${name}, ${why}`}
									value={money(job.amount)}
								/>
							);
						})}
					</View>
					{plan.restOptions.length > 1 && plan.rest.minor > 0 ? (
						<View style={{ gap: space[1] }}>
							<FieldLabel>
								{t("restTitle", { amount: money(plan.rest) })}
							</FieldLabel>
							<Picker
								onChange={(value) => setRest(value as RestChoice)}
								options={plan.restOptions.map((option) => ({
									value: option.choice,
									label: restLabel(option),
								}))}
								value={rest}
							/>
						</View>
					) : plan.rest.minor > 0 ? (
						<Note>
							{t("restStays", { amount: money(plan.rest), pool: poolName })}
						</Note>
					) : null}
				</WriteForm>
			)}
		</FormSheet>
	);
}
