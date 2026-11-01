"use client";

import { Info, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

/** Remembered per viewer: once opened, Note, Location and Spread stay open (kit OPEN). */
function remembered(key: string): boolean {
	try {
		return localStorage.getItem(`rs:entry:open:${key}`) === "1";
	} catch {
		return false;
	}
}
function remember(key: string) {
	try {
		localStorage.setItem(`rs:entry:open:${key}`, "1");
	} catch {
		// Storage blocked: it opens for this sheet only.
	}
}

/**
 * Spread over and Exclude from spending (personal only), then Note and
 * Location. Rare fields wait behind "+ Note" style buttons until opened
 * once; a field with a value is always open.
 */
export function OptionsSection(p: {
	d: ExpenseDraft;
	personal: boolean;
	onSet: (patch: Partial<ExpenseDraft>) => void;
	onExclude: () => void;
}) {
	const t = useTranslations("entry.expense");
	const { d } = p;
	const [open, setOpen] = useState(() => ({
		note: remembered("note") || !!d.note,
		loc: remembered("loc") || !!d.location,
		spread: remembered("spread") || d.spread !== "one",
	}));
	const reveal = (k: keyof typeof open) => {
		remember(k);
		setOpen((o) => ({ ...o, [k]: true }));
	};
	const showSpread = p.personal && open.spread;
	return (
		<div className="flex flex-col gap-3">
			{showSpread ? (
				<div className="flex min-h-ctl items-center justify-between gap-3">
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
			) : null}
			{p.personal ? (
				<div className="flex flex-col gap-1">
					<div className="flex min-h-ctl items-center justify-between gap-3">
						<span className="flex items-center gap-2 text-body text-fg">
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
			) : null}
			{open.note || open.loc ? (
				<div className="grid gap-3 md:grid-cols-2">
					{open.note ? (
						<Field htmlFor="entry-note" label={t("note")}>
							<Input
								id="entry-note"
								onChange={(e) => p.onSet({ note: e.target.value })}
								placeholder={t("notePlaceholder")}
								value={d.note}
							/>
						</Field>
					) : null}
					{open.loc && p.personal ? (
						<Field htmlFor="entry-location" label={t("location")}>
							<Input
								id="entry-location"
								onChange={(e) => p.onSet({ location: e.target.value })}
								placeholder={t("locationPlaceholder")}
								value={d.location}
							/>
						</Field>
					) : null}
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				{!open.note ? (
					<AddButton label={t("note")} onClick={() => reveal("note")} />
				) : null}
				{!open.loc && p.personal ? (
					<AddButton label={t("location")} onClick={() => reveal("loc")} />
				) : null}
				{!open.spread && p.personal ? (
					<AddButton label={t("spreadAdd")} onClick={() => reveal("spread")} />
				) : null}
			</div>
		</div>
	);
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<Button kind="ghost" onClick={onClick} size="sm">
			<Plus aria-hidden="true" />
			{label}
		</Button>
	);
}
