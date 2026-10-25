"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { Field } from "~/features/entry/shared-ui";
import { api } from "~/trpc/react";
import { SetupEnvelopesStep } from "./setup-envelopes-step";
import { SetupPayStep } from "./setup-pay-step";
import { type Choice, SetupStyleStep } from "./setup-style-step";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { useSetup } from "./use-setup";

type Step = "style" | "pay" | "money" | "envelopes";

/** The questions each answer asks: Track stops at the first, Limits asks for no money now or pay. */
function stepsOf(choice: Choice): Step[] {
	if (choice === "TRACK") return ["style"];
	if (choice === "LIMITS") return ["style", "envelopes"];
	return ["style", "pay", "money", "envelopes"];
}

/**
 * Set up your budget (the first run, the mockup's wizard): how do you like
 * to budget, how you get paid, how much can you budget now, your envelopes,
 * and a clear stop when the plan costs more than you have. One question a
 * step; nothing is written until the last. The server previews exactly what
 * is created, a Pay off debt plan and the pay cycle included.
 */
function SetupForm({ open, onClose }: SheetProps) {
	const t = useTranslations("budgetSheets.setup");
	const tp = useTranslations("budgetSheets.pool");
	const locale = useLocale();
	const s = useSetup(locale);
	const toast = useToast();
	const [choice, setChoice] = useState<Choice>("FLEX");
	const [at, setAt] = useState(0);
	const [covered, setCovered] = useState(false);
	const steps = stepsOf(choice);
	const step = steps[at] ?? "style";
	const last = at === steps.length - 1;
	const preview = api.envelope.setupPreview.useMutation();
	const commit = api.envelope.setup.useMutation();
	const w = useMoneyWrite({
		input: choice === "TRACK" ? null : s.input,
		preview: preview.mutateAsync,
		commit: async (input) => {
			// The proposal is refused once the budget exists: stop reading it first.
			s.setDone(true);
			try {
				return await commit.mutateAsync(input);
			} catch (error) {
				s.setDone(false);
				throw error;
			}
		},
		toast: () => t("toast"),
	});
	const result = w.dry.preview?.value ?? null;
	const plan = result?.plan ?? null;
	const stopped = !!plan && plan.short.minor > 0 && !covered;
	const p = s.preset;

	const pick = (c: Choice) => {
		setChoice(c);
		setCovered(false);
		if (c !== "TRACK") s.setStyle(c);
	};
	/** Continue goes to the next question; the last step writes (Track writes nothing). */
	const go = async () => {
		if (!last) {
			setAt(at + 1);
			return;
		}
		try {
			if (choice !== "TRACK") await w.submit();
		} catch {
			toast.failed(t("failed"));
			return;
		}
		onClose();
	};
	const ready = choice === "TRACK" || !last || (w.ready && !stopped);
	return (
		<Sheet
			detent="large"
			footer={
				<>
					<Button
						kind="secondary"
						onClick={() => (at === 0 ? onClose() : setAt(at - 1))}
					>
						{at === 0 ? t("cancel") : t("back")}
					</Button>
					<Button
						data-sheet-submit=""
						disabled={!ready}
						kind="primary"
						onClick={() => void go()}
					>
						{!last
							? t("continue")
							: choice === "TRACK"
								? t("startTracking")
								: stopped
									? t("startStopped")
									: t("start")}
					</Button>
				</>
			}
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title")}
			wide
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-3 text-meta">
					{t("step", { at: at + 1, total: steps.length })}
				</p>
				{step === "style" ? (
					<SetupStyleStep onChange={pick} value={choice} />
				) : step === "pay" ? (
					<SetupPayStep onChange={s.setPay} value={s.pay} />
				) : !p || s.loading ? (
					<SkeletonRows count={4} />
				) : step === "money" ? (
					<div className="flex flex-col gap-4">
						<div>
							<h2 className="text-fg text-section">{t("moneyTitle")}</h2>
							<p className="text-fg-2 text-small">{t("moneySub")}</p>
						</div>
						<Field label={t("haveNow")}>
							<MoneyInput
								autoFocus
								currency={p.currency}
								onChange={(text) => s.money.set(text)}
								value={s.money.text}
							/>
						</Field>
					</div>
				) : (
					<SetupEnvelopesStep
						covered={covered}
						dry={w.dry}
						onCovered={setCovered}
						poolName={tp(
							s.style === "EVERY_DOLLAR" ? "toAssign" : "notPlannedYet",
						)}
						result={result}
						s={s}
					/>
				)}
			</div>
		</Sheet>
	);
}

/**
 * Set up your budget only when there is none: setup refuses a second book,
 * so with one the sheet says so instead of offering a form that cannot save.
 */
export function SetupSheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.setup");
	const book = useMonth(props.month);
	// Read once: the budget this sheet creates must not turn it into the message.
	const had = useRef<boolean | null>(null);
	if (had.current === null && !book.loading) had.current = book.data !== null;
	if (had.current)
		return (
			<Sheet
				cancelLabel={t("ok")}
				detent="medium"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("title")}
			>
				<p className="text-fg-2 text-small">{t("exists")}</p>
			</Sheet>
		);
	return <SetupForm {...props} />;
}
