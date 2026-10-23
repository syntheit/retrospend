"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { Member, PageView } from "../types";
import { MemberDatesSheet } from "./member-dates-sheet";

/** The API takes major units: the exact decimal text of the minor amount, read as a number. */
const major = (minor: number, currency: string) =>
	Number(fromMinor({ minor, currency }));

/**
 * Project settings: name, note, currency and budget, auto-accept, your own
 * analytics switch, and the members with their dates (each change previewed
 * in its own sheet). Saving ends with Undo, which writes the old values back.
 */
export function SettingsSheet({
	view,
	onOpenChange,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.settings");
	const locale = useLocale();
	const toast = useToast();
	const { short } = useRowDates();
	const utils = api.useUtils();
	const refresh = () => utils.project.invalidate();
	const update = api.project.update.useMutation({ onSuccess: refresh });
	const analytics = api.project.updateAnalyticsExclusion.useMutation({
		onSuccess: refresh,
	});
	const [name, setName] = useState(view.name);
	const [note, setNote] = useState(view.description ?? "");
	const [currency, setCurrency] = useState(view.primaryCurrency);
	const [budget, setBudget] = useState(() =>
		view.budget
			? draftFromMinor(
					view.budget.amount.minor,
					locale,
					view.budget.amount.currency,
				)
			: "",
	);
	const [autoAccept, setAutoAccept] = useState(view.autoAcceptSplits);
	const [excluded, setExcluded] = useState(view.excludeFromAnalytics);
	const [dates, setDates] = useState<Member | null>(null);
	const [tried, setTried] = useState(false);
	const parsed = parseMoneyInput(budget, locale, currency);
	const budgetBad = budget.trim() !== "" && !parsed.ok;
	const owner = view.myRole === "ORGANIZER";

	const before = {
		id: view.id,
		name: view.name,
		description: view.description,
		primaryCurrency: view.primaryCurrency,
		budgetAmount: view.budget
			? major(view.budget.amount.minor, view.budget.amount.currency)
			: null,
		budgetCurrency: view.budget?.amount.currency ?? null,
		autoAcceptSplits: view.autoAcceptSplits,
	};

	const submit = async () => {
		setTried(true);
		if (!name.trim() || budgetBad) return false;
		await update.mutateAsync({
			id: view.id,
			name: name.trim(),
			description: note.trim() || null,
			primaryCurrency: currency,
			budgetAmount: parsed.ok ? major(parsed.minor, currency) : null,
			budgetCurrency: parsed.ok ? currency : null,
			autoAcceptSplits: autoAccept,
		});
		if (excluded !== view.excludeFromAnalytics)
			await analytics.mutateAsync({ projectId: view.id, exclude: excluded });
		toast.saved(t("saved"), {
			undo: async () => {
				await update.mutateAsync(before);
				if (excluded !== view.excludeFromAnalytics)
					await analytics.mutateAsync({
						projectId: view.id,
						exclude: view.excludeFromAnalytics,
					});
			},
		});
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-name">{t("name")}</Label>
					<Input
						aria-invalid={tried && !name.trim() ? true : undefined}
						disabled={!owner && view.myRole !== "EDITOR"}
						id="ps-name"
						maxLength={191}
						onChange={(e) => setName(e.target.value)}
						value={name}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-note">{t("note")}</Label>
					<Textarea
						id="ps-note"
						maxLength={500}
						onChange={(e) => setNote(e.target.value)}
						rows={2}
						value={note}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-budget">{t("budget")}</Label>
					<MoneyInput
						currency={currency}
						id="ps-budget"
						onChange={setBudget}
						onCurrencyChange={setCurrency}
						showErrors={tried && budgetBad}
						value={budget}
					/>
					<span className="text-fg-3 text-meta">{t("budgetHint")}</span>
				</div>
				<div className="min-h-ctl flex items-center justify-between gap-3">
					<Label htmlFor="ps-accept">{t("autoAccept")}</Label>
					<Switch
						checked={autoAccept}
						id="ps-accept"
						onCheckedChange={setAutoAccept}
					/>
				</div>
				<div className="min-h-ctl flex items-center justify-between gap-3">
					<Label htmlFor="ps-analytics">{t("exclude")}</Label>
					<Switch
						checked={excluded}
						id="ps-analytics"
						onCheckedChange={setExcluded}
					/>
				</div>
				{view.solo ? null : (
					<div className="flex flex-col gap-1">
						<span className="text-fg text-body font-medium">
							{t("members")}
						</span>
						<RowList label={t("members")} variant="flat">
							{view.members.map((m) => (
								<Row
									end={
										<Button
											kind="secondary"
											onClick={() => setDates(m)}
											size="sm"
										>
											{t("dates")}
										</Button>
									}
									key={m.id}
									lead={
										<Face imageUrl={m.imageUrl} name={m.name} size="default" />
									}
									sub={
										<RowSub
											parts={[
												m.joinedOn
													? t("since", { date: short(m.joinedOn) })
													: t("fromStart"),
												m.leftOn ? t("left", { date: short(m.leftOn) }) : null,
											]}
										/>
									}
									title={m.isMe ? t("you", { name: m.name }) : m.name}
								/>
							))}
						</RowList>
						<span className="text-fg-3 text-meta">{t("datesHint")}</span>
					</div>
				)}
			</div>
			{dates ? (
				<MemberDatesSheet
					member={dates}
					onOpenChange={(o) => !o && setDates(null)}
					view={view}
				/>
			) : null}
		</Sheet>
	);
}
