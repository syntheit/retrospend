import { dayKey } from "@retrospend/domain/time-zone";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { Note, SheetBody, useAmountLocale } from "./parts";
import {
	EnvelopesStep,
	MoneyStep,
	PayStep,
	PlanStop,
	StyleStep,
} from "./SetupSteps";
import {
	nameKeyPath,
	type PayAnswer,
	payAnswered,
	type SetupChoice,
	type SetupDraft,
	setupBody,
	stepsOf,
} from "./setupBody";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi } from "./WriteFrame";

const FRESH: SetupDraft = {
	style: "FLEX",
	off: new Set(),
	amounts: {},
	haveNowMinor: null,
	pay: { frequency: null, next: "" },
	strategy: "AVALANCHE",
};

interface Plan {
	cost: { minor: number; currency: string };
	available: { minor: number; currency: string };
	short: { minor: number; currency: string };
}

/** The plan cost the dry run reports, if it did. */
function planOf(preview: unknown): {
	plan: Plan | null;
	nextPay: string | null;
} {
	const result = (
		preview as {
			detail?: { result?: { plan?: Plan | null; nextPay?: string | null } };
		} | null
	)?.detail?.result;
	return { plan: result?.plan ?? null, nextPay: result?.nextPay ?? null };
}

/**
 * Set up your budget: how you like to budget, how you get paid, what you can
 * budget now, then the style's envelopes. One question a step; nothing is
 * written until the last. The server's dry run of the exact setup shows what
 * is created and stops a plan that costs more than you have. A first set-up
 * cannot be taken back, so its toast has no Undo.
 */
export function SetupSheet({
	visible,
	onClose,
	onDone,
}: {
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.setup");
	const tn = useTranslations("mobile.budget.setup.names");
	const api = useApi();
	const announce = useUndoToast("budget");
	const locale = useAmountLocale();
	const { space } = useTheme();
	const [choice, setChoice] = useState<SetupChoice>("FLEX");
	const [draft, setDraft] = useState<SetupDraft>(FRESH);
	const [at, setAt] = useState(0);
	const [haveText, setHaveText] = useState("");
	const [covered, setCovered] = useState(false);
	const today = dayKey(new Date());
	const steps = stepsOf(choice);
	const step = steps[at] ?? "style";
	const last = at === steps.length - 1;

	useEffect(() => {
		if (!visible) return;
		setChoice("FLEX");
		setDraft(FRESH);
		setAt(0);
		setHaveText("");
		setCovered(false);
	}, [visible]);

	const preset = useSheetRead(
		visible && choice !== "TRACK",
		(client) => client.budget.setupPreset({ style: draft.style }),
		draft.style,
	);
	const proposal = preset.status === "ready" ? preset.data : null;
	// A new style starts from its own proposal.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only the style resets the answers
	useEffect(() => {
		setDraft((d) => ({ ...d, off: new Set(), amounts: {} }));
		setCovered(false);
	}, [draft.style]);

	const nameOf = useCallback(
		(nameKey: string | null, fallback: string | null) =>
			fallback ??
			(nameKey
				? (tn as unknown as (key: string) => string)(nameKeyPath(nameKey))
				: ""),
		[tn],
	);
	const haveNowMinor = minorOf(
		readAmount(haveText, locale, proposal?.currency ?? ""),
		true,
	);
	const full = { ...draft, haveNowMinor };
	const body =
		proposal && choice !== "TRACK" && last
			? setupBody(proposal, full, nameOf)
			: null;
	const { idFor } = useWriteIds(visible && body ? JSON.stringify(body) : null);
	const key = body ? idFor("setup") : null;
	const flow = useMoneyWrite({
		input: body,
		idempotencyKey: key,
		preview: (b) => (api ? api.budget.previewSetup(b) : noSession()),
		write: (b, k) =>
			api
				? api.budget.setup(b, { context: { idempotencyKey: k } })
				: noSession(),
	});
	const { plan, nextPay } = planOf(flow.preview);
	const stopped = plan !== null && plan.short.minor > 0 && !covered;

	const pick = (c: SetupChoice) => {
		setChoice(c);
		setCovered(false);
		if (c !== "TRACK") setDraft((d) => ({ ...d, style: c }));
	};
	const setPay = (pay: PayAnswer) => setDraft((d) => ({ ...d, pay }));

	async function go() {
		if (!last) return setAt(at + 1);
		if (choice === "TRACK") return onClose();
		const out = await flow.commit();
		if (!out) return;
		announce({ message: t("toast"), token: out.undo, onChanged: onDone });
		onClose();
	}

	const payOk = step !== "pay" || payAnswered(draft.pay, today);
	const ready =
		payOk &&
		(choice === "TRACK" || !last || (flow.status === "ready" && !stopped));
	const label = !last
		? t("continue")
		: choice === "TRACK"
			? t("startTracking")
			: stopped
				? t("startStopped")
				: flow.committing
					? t("starting")
					: t("start");

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<Note>{t("step", { at: at + 1, total: steps.length })}</Note>
				{step === "style" ? (
					<StyleStep onChange={pick} value={choice} />
				) : step === "pay" ? (
					<PayStep onChange={setPay} today={today} value={draft.pay} />
				) : !proposal ? (
					<Note>
						{preset.status === "error" ? t("presetError") : t("loading")}
					</Note>
				) : step === "money" ? (
					<MoneyStep
						currency={proposal.currency}
						draft={haveText}
						onDraft={setHaveText}
					/>
				) : (
					<>
						<EnvelopesStep
							draft={draft}
							nameOf={nameOf}
							onAmount={(k, minor) =>
								setDraft((d) => ({
									...d,
									amounts: { ...d.amounts, [k]: minor },
								}))
							}
							onToggle={(k) =>
								setDraft((d) => {
									const off = new Set(d.off);
									if (off.has(k)) off.delete(k);
									else off.add(k);
									return { ...d, off };
								})
							}
							preset={proposal}
						/>
						<BudgetChanges
							data={null}
							preview={flow.preview}
							status={flow.status}
						/>
						{plan ? (
							<PlanStop
								available={plan.available}
								cost={plan.cost}
								covered={covered}
								nextPay={nextPay}
								onCovered={setCovered}
								short={plan.short}
							/>
						) : null}
						{flow.commitFailed ? (
							<Note tone="attention">{t("failed")}</Note>
						) : null}
					</>
				)}
				<View style={{ gap: space[2] }}>
					<Button
						disabled={!ready || flow.committing}
						label={label}
						onPress={() => void go()}
					/>
					<Button
						label={at === 0 ? t("cancel") : t("back")}
						onPress={() => (at === 0 ? onClose() : setAt(at - 1))}
						variant="text"
					/>
				</View>
			</SheetBody>
		</Sheet>
	);
}
