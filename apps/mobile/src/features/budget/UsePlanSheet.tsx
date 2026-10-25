import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Picker } from "@/ui/Picker";
import { Sheet } from "@/ui/Sheet";
import { BudgetChanges } from "./BudgetChanges";
import { planBody, type RestChoice } from "./bodies";
import { monthDate } from "./months";
import { Line, Note, SheetBody } from "./parts";
import { type BudgetMonth, envelopeById, type FillPlan } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

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
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.usePlan");
	const tb = useTranslations("mobile.budget");
	const format = useFormatter();
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const { color, space, type } = useTheme();
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

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: input?.batchId ?? null,
		preview: (body) => (api ? api.budget.previewUsePlan(body) : noSession()),
		write: (body, key) => {
			if (!api) return noSession();
			// biome-ignore lint/correctness/useHookAtTopLevel: `usePlan` is the API route's name, not a hook
			return api.budget.usePlan(body, { context: { idempotencyKey: key } });
		},
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		const count = new Set(out.result.lines.map((l) => l.envelopeId)).size;
		announce({
			message: t("toast", { count }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

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
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				{loadFailed ? (
					<Note tone="attention">{t("loadError")}</Note>
				) : !plan ? (
					<Note>{tb("preview.checking")}</Note>
				) : jobs.length === 0 ? (
					<Note>{t("met")}</Note>
				) : (
					<WriteFrame
						busy={flow.committing}
						changes={
							<BudgetChanges
								data={data}
								preview={flow.preview}
								status={flow.status}
							/>
						}
						failed={flow.commitFailed}
						onSubmit={submit}
						ready={flow.status === "ready"}
						submitLabel={t("use")}
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
								<Text style={{ color: color.fg2, fontSize: type.small.size }}>
									{t("restTitle", { amount: money(plan.rest) })}
								</Text>
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
					</WriteFrame>
				)}
			</SheetBody>
		</Sheet>
	);
}
