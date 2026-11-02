"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Tip } from "~/components/ui/tooltip";
import { Field } from "../shared-ui";
import type { ExpenseDraft, SpreadChoice } from "./draft";

const SPREADS: SpreadChoice[] = ["one", "2", "3", "6", "12", "24"];
/** The server accepts a place up to this long. */
const LOCATION_LIMIT = 191;

/**
 * The More panel: Note and Location side by side, Spread over, then Exclude
 * from spending, all in view (the form before the composer had them in view;
 * nothing waits behind a "+" button). A shared expense keeps only its note,
 * as the server does.
 */
export function OptionsSection(p: {
	d: ExpenseDraft;
	personal: boolean;
	onSet: (patch: Partial<ExpenseDraft>) => void;
	onExclude: () => void;
}) {
	const t = useTranslations("entry.expense");
	const { d } = p;
	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-3 md:grid-cols-2">
				<Field htmlFor="entry-note" label={t("note")}>
					<Input
						id="entry-note"
						onChange={(e) => p.onSet({ note: e.target.value })}
						placeholder={t("notePlaceholder")}
						value={d.note}
					/>
				</Field>
				{p.personal ? (
					<Field htmlFor="entry-location" label={t("location")}>
						<Input
							id="entry-location"
							maxLength={LOCATION_LIMIT}
							onChange={(e) => p.onSet({ location: e.target.value })}
							placeholder={t("locationPlaceholder")}
							value={d.location}
						/>
					</Field>
				) : null}
			</div>
			{p.personal ? (
				<>
					<div className="min-h-ctl flex items-center justify-between gap-3">
						<span className="text-body text-fg">{t("spread")}</span>
						<Select
							kit
							onValueChange={(v) => p.onSet({ spread: v as SpreadChoice })}
							value={d.spread}
						>
							<SelectTrigger aria-label={t("spread")} className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SPREADS.map((s) => (
									<SelectItem key={s} value={s}>
										{s === "one"
											? t("spreadOne")
											: t("spreadMonths", { count: Number(s) })}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1">
						<div className="min-h-ctl flex items-center justify-between gap-3">
							<span className="text-body text-fg flex items-center gap-2">
								{t("exclude")}
								<Tip content={t("excludeTip")}>
									<Button
										aria-label={t("excludeTip")}
										icon
										kind="ghost"
										size="sm"
									>
										<Info />
									</Button>
								</Tip>
							</span>
							<Switch
								aria-label={t("exclude")}
								checked={d.exclude}
								onCheckedChange={p.onExclude}
							/>
						</div>
						{d.excludeAuto && d.exclude ? (
							<span className="text-fg-3 text-meta">{t("excludeAuto")}</span>
						) : null}
					</div>
				</>
			) : null}
		</div>
	);
}
