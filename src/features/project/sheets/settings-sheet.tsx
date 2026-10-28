"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
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
import { inOurWords } from "../errors";
import type { Member, PageView } from "../types";
import { MemberDatesSheet } from "./member-dates-sheet";

/** The API takes major units: the exact decimal text of the minor amount, read as a number. */
const major = (minor: number, currency: string) =>
	Number(fromMinor({ minor, currency }));

/** The sheet's fields, and a save that ends with Undo (the old values written back). */
function useSettingsDraft(view: PageView) {
	const t = useTranslations("projectV2.settings");
	const te = useTranslations("projectV2.errors");
	const locale = useMoneyLocale();
	const toast = useToast();
	const utils = api.useUtils();
	const refresh = () => utils.project.invalidate();
	const update = api.project.update.useMutation({ onSuccess: refresh });
	const analytics = api.project.updateAnalyticsExclusion.useMutation({
		onSuccess: refresh,
	});
	const b = view.budget?.amount;
	const [name, setName] = useState(view.name);
	const [note, setNote] = useState(view.description ?? "");
	const [currency, setCurrency] = useState(view.primaryCurrency);
	const [budget, setBudget] = useState(() =>
		b ? draftFromMinor(b.minor, locale, b.currency) : "",
	);
	const [autoAccept, setAutoAccept] = useState(view.autoAcceptSplits);
	const [excluded, setExcluded] = useState(view.excludeFromAnalytics);
	const [tried, setTried] = useState(false);
	const parsed = parseMoneyInput(budget, locale, currency);
	const budgetBad = budget.trim() !== "" && !parsed.ok;
	const exclusionChanged = excluded !== view.excludeFromAnalytics;

	const write = async (
		patch: Parameters<typeof update.mutateAsync>[0],
		exclude: boolean,
	) => {
		await update.mutateAsync(patch);
		if (exclusionChanged)
			await analytics.mutateAsync({ projectId: view.id, exclude });
	};
	const submit = async () => {
		setTried(true);
		if (!name.trim() || budgetBad) return false;
		const next = {
			id: view.id,
			name: name.trim(),
			description: note.trim() || null,
			primaryCurrency: currency,
			budgetAmount: parsed.ok ? major(parsed.minor, currency) : null,
			budgetCurrency: parsed.ok ? currency : null,
			autoAcceptSplits: autoAccept,
		};
		const before = {
			id: view.id,
			name: view.name,
			description: view.description,
			primaryCurrency: view.primaryCurrency,
			budgetAmount: b ? major(b.minor, b.currency) : null,
			budgetCurrency: b?.currency ?? null,
			autoAcceptSplits: view.autoAcceptSplits,
		};
		await inOurWords(() => write(next, excluded), te("failed"));
		toast.saved(t("saved"), {
			undo: () => write(before, view.excludeFromAnalytics),
		});
	};
	return {
		fields: { name, note, currency, budget, autoAccept, excluded },
		set: {
			setName,
			setNote,
			setCurrency,
			setBudget,
			setAutoAccept,
			setExcluded,
		},
		tried,
		budgetBad,
		submit,
	};
}

/** Members with their dates; Dates opens the previewed dates sheet. */
function Members({
	view,
	onDates,
}: {
	view: PageView;
	onDates: (m: Member) => void;
}) {
	const t = useTranslations("projectV2.settings");
	const { short } = useRowDates();
	return (
		<div className="flex flex-col gap-1">
			<span className="text-fg text-body font-medium">{t("members")}</span>
			<RowList label={t("members")} variant="flat">
				{view.members.map((m) => (
					<Row
						end={
							<Button kind="secondary" onClick={() => onDates(m)} size="sm">
								{t("dates")}
							</Button>
						}
						key={m.id}
						lead={<Face imageUrl={m.imageUrl} name={m.name} size="default" />}
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
	);
}

/** One labeled switch row. */
function SwitchRow(props: {
	id: string;
	label: string;
	on: boolean;
	set: (v: boolean) => void;
}) {
	return (
		<div className="min-h-ctl flex items-center justify-between gap-3">
			<Label htmlFor={props.id}>{props.label}</Label>
			<Switch checked={props.on} id={props.id} onCheckedChange={props.set} />
		</div>
	);
}

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
	const d = useSettingsDraft(view);
	const [dates, setDates] = useState<Member | null>(null);
	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={d.submit}
			open
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-name">{t("name")}</Label>
					<Input
						aria-invalid={d.tried && !d.fields.name.trim() ? true : undefined}
						id="ps-name"
						maxLength={191}
						onChange={(e) => d.set.setName(e.target.value)}
						value={d.fields.name}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-note">{t("note")}</Label>
					<Textarea
						id="ps-note"
						maxLength={500}
						onChange={(e) => d.set.setNote(e.target.value)}
						rows={2}
						value={d.fields.note}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="ps-budget">{t("budget")}</Label>
					<MoneyInput
						currency={d.fields.currency}
						id="ps-budget"
						onChange={d.set.setBudget}
						onCurrencyChange={d.set.setCurrency}
						showErrors={d.tried && d.budgetBad}
						value={d.fields.budget}
					/>
					<span className="text-fg-3 text-meta">{t("budgetHint")}</span>
				</div>
				<SwitchRow
					id="ps-accept"
					label={t("autoAccept")}
					on={d.fields.autoAccept}
					set={d.set.setAutoAccept}
				/>
				<SwitchRow
					id="ps-analytics"
					label={t("exclude")}
					on={d.fields.excluded}
					set={d.set.setExcluded}
				/>
				{view.solo ? null : <Members onDates={setDates} view={view} />}
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
