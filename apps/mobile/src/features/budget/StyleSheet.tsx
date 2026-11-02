import { useState } from "react";
import { useTranslations } from "use-intl";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { useResetOnOpen } from "@/features/write/useResetOnOpen";
import { AmountField } from "@/ui/AmountField";
import { ChipGroup } from "@/ui/Chip";
import type { SheetDetent } from "@/ui/Sheet";
import { type SwitchStyle, styleBody } from "./moreBodies";
import type { BudgetMonth } from "./source";
import { FormSheet, WriteForm } from "./WriteSheet";

/** Every style a book can switch to, in the order the web lists them. */
export const STYLES: readonly SwitchStyle[] = [
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
	"LIMITS",
	"DEBT_PAYOFF",
];

/**
 * Switch the budget style. Between income styles nothing but the style
 * changes; leaving Limits asks how much you have right now so To assign can
 * start true. The dry run shows what moves, and the toast switches back.
 */
export function StyleSheet({
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
	const t = useTranslations("mobile.budget.style");
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const current = data.book.style;
	const [picked, setPicked] = useState<SwitchStyle | null>(null);
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const leavingLimits = current === "LIMITS" && picked !== null;
	const { idFor, reset } = useWriteIds(visible ? `${picked}|${draft}` : null);
	useResetOnOpen(visible, () => {
		reset();
		setPicked(null);
		setDraft("");
	});

	const body = picked
		? styleBody({
				id: idFor("style"),
				style: picked,
				from: current,
				haveNowMinor: minorOf(entered, true),
				currency,
			})
		: null;
	const choices = STYLES.filter((s) => s !== current).map((s) => ({
		value: s,
		label: t(`name.${s}`),
	}));
	return (
		<FormSheet
			detent={detent}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<WriteForm
				active={visible}
				data={data}
				idempotencyKey={body?.id ?? null}
				input={body}
				message={() => t("toast", { style: picked ? t(`name.${picked}`) : "" })}
				onClose={onClose}
				onDone={onDone}
				preview={(api, b) => api.budget.previewSetStyle(b)}
				submitLabel={t("submit")}
				write={(api, b, key) =>
					api.budget.setStyle(b, { context: { idempotencyKey: key } })
				}
			>
				<ChipGroup
					accessibilityLabel={t("title")}
					onChange={setPicked}
					options={choices}
					value={picked}
				/>
				{picked ? <Note>{t(`about.${picked}`)}</Note> : null}
				{leavingLimits ? (
					<AmountField
						allowZero
						currency={currency}
						draft={draft}
						entered={entered}
						label={t("haveNow")}
						onDraftChange={setDraft}
					/>
				) : null}
			</WriteForm>
		</FormSheet>
	);
}
