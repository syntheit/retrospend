"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Sheet } from "~/components/ui/sheet";
import { ChangeValue } from "~/components/ui/sheet-changes";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type SetStyleInput = RouterInputs["envelope"]["setStyle"];
type Style = SetStyleInput["style"] | "TRACK";

/** The styles a switch can reach today, in the order the picker lists them. */
const STYLES: Style[] = [
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"LIMITS",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
	"TRACK",
];

/**
 * Budget style (SPEC §4.4): a style sets defaults and the number at the top;
 * your envelopes, history and splits stay. The server previews the switch
 * (leaving Limits asks what you have now; leftover rules that follow the
 * style change are listed) and Undo puts the old style back. Just track
 * pauses the budget and moves no money.
 */
export function StyleSheet({
	open,
	onClose,
	month,
}: SheetComponentProps<"style">) {
	const t = useTranslations("budgetSheets.style");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { refresh, saved } = useBudgetWrite();
	const book = m.data?.book ?? null;
	const current: Style | null = book
		? book.paused
			? "TRACK"
			: (book.style as Style)
		: null;
	const [picked, setPicked] = useState<Style | null>(null);
	const target = picked ?? current;
	const leavingLimits = current === "LIMITS" && target !== "LIMITS";
	const haveNow = useAmount(book?.currency ?? "");
	const [id] = useState(newId);

	const styleChange =
		target !== current && target !== "TRACK" && current !== "TRACK";
	const input: SetStyleInput | null =
		styleChange && target && (!leavingLimits || haveNow.minor !== null)
			? {
					id,
					style: target,
					leftovers: "STYLE_DEFAULT",
					...(leavingLimits && haveNow.minor !== null
						? { haveNowMinor: haveNow.minor }
						: {}),
				}
			: null;
	const preview = api.envelope.setStylePreview.useMutation();
	const commit = api.envelope.setStyle.useMutation();
	const revert = api.envelope.revertStyle.useMutation();
	const pause = api.envelope.pause.useMutation();
	const resume = api.envelope.resume.useMutation();
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (_r, i) => t("toast", { style: t(`${i.style}.name`) }),
		undo: () => () => revert.mutateAsync({}),
	});

	const onSubmit = async () => {
		if (target === "TRACK" && current !== "TRACK") {
			await pause.mutateAsync();
			await refresh();
			saved(t("toastPaused"), () => resume.mutateAsync());
			return undefined;
		}
		if (current === "TRACK" && target !== "TRACK") {
			await resume.mutateAsync();
			await refresh();
			saved(t("toastResumed"), () => pause.mutateAsync());
			return undefined;
		}
		return w.submit();
	};
	const noMoney = target === "TRACK" || current === "TRACK";
	const ready = noMoney ? target !== current : w.ready;

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={!ready}
			submitLabel={t("switch")}
			title={t("title")}
			wide
		>
			{m.loading || !book || !target ? (
				<SkeletonRows count={4} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<Field label={t("style")}>
						<Select
							kit
							onValueChange={(v) => setPicked(v as Style)}
							value={target}
						>
							<SelectTrigger aria-label={t("style")} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{STYLES.map((s) => (
									<SelectItem key={s} value={s}>
										{t(`${s}.name`)}
										{s === current ? ` · ${t("current")}` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<p className="text-fg-2 text-small">{t(`${target}.sub`)}</p>
					<p className="text-fg-2 text-small">
						<span className="text-fg font-medium">{t("lead")}</span>{" "}
						{t(`${target}.lead`)}
					</p>
					{leavingLimits ? (
						<Field label={t("haveNow")}>
							<MoneyInput
								currency={book.currency}
								onChange={(text) => haveNow.set(text)}
								value={haveNow.text}
							/>
						</Field>
					) : null}
					{target === current ? (
						<p className="text-fg-3 text-small">{t("same")}</p>
					) : noMoney ? (
						<p className="text-fg-3 text-small">
							{target === "TRACK" ? t("pauses") : t("resumes")}
						</p>
					) : (
						<FigureChanges
							dry={w.dry}
							own={(p) =>
								p.value.ruleChanges.map((c) => ({
									key: `rule-${c.envelopeId}`,
									label: t("leftovers", {
										name:
											m.byId.get(c.envelopeId)?.name ?? t("envelopeFallback"),
									}),
									value: (
										<ChangeValue
											from={t(`leftover.${c.from}`)}
											to={t(`leftover.${c.to}`)}
										/>
									),
								}))
							}
							poolName={pool}
						/>
					)}
				</div>
			)}
		</Sheet>
	);
}
