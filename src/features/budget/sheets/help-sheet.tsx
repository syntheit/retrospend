"use client";

import { useTranslations } from "next-intl";
import { Sheet } from "~/components/ui/sheet";
import type { SheetProps } from "./types";
import { useMonth } from "./use-month";

const WORDS = [
	"toAssign",
	"leftToSpend",
	"leftInLimits",
	"envelope",
	"target",
	"left",
	"overBy",
	"cover",
	"carries",
	"moneyIn",
	"owed",
] as const;
type Word = (typeof WORDS)[number];

/** Which words a style uses: Limits has no To assign, the others no limits. */
function shown(word: Word, style: string | null): boolean {
	if (word === "toAssign") return style !== "LIMITS";
	if (word === "leftInLimits") return style === "LIMITS";
	if (word === "leftToSpend")
		return style !== "LIMITS" && style !== "EVERY_DOLLAR";
	return true;
}

/**
 * What the words mean (T4 #5): one plain line per word the page uses,
 * reachable from every hero and the menu. Words that belong to another
 * style are left out.
 */
export function HelpSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.help");
	const m = useMonth(month);
	const style = m.data?.book.style ?? null;
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title")}
		>
			<dl className="flex flex-col gap-3 pb-4">
				{WORDS.filter((w) => shown(w, style)).map((w) => (
					<div key={w}>
						<dt className="text-fg text-body font-semibold">
							{t(`${w}.term`)}
						</dt>
						<dd className="text-fg-2 text-small">{t(`${w}.meaning`)}</dd>
					</div>
				))}
			</dl>
		</Sheet>
	);
}
