import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Sheet } from "@/ui/Sheet";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList } from "./fields";
import { type SwitchStyle, styleBody } from "./moreBodies";
import { AmountField, Note, SheetBody, useAmountLocale } from "./parts";
import type { BudgetMonth } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

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
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.style");
	const api = useApi();
	const announce = useUndoToast("budget");
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const current = data.book.style;
	const [picked, setPicked] = useState<SwitchStyle | null>(null);
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const leavingLimits = current === "LIMITS" && picked !== null;
	const { idFor, reset } = useWriteIds(visible ? `${picked}|${draft}` : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening starts empty
	useEffect(() => {
		if (!visible) return;
		reset();
		setPicked(null);
		setDraft("");
	}, [visible]);

	const body = picked
		? styleBody({
				id: idFor("style"),
				style: picked,
				from: current,
				haveNowMinor: minorOf(entered, true),
				currency,
			})
		: null;
	const flow = useMoneyWrite({
		input: visible ? body : null,
		idempotencyKey: body?.id ?? null,
		preview: (b) => (api ? api.budget.previewSetStyle(b) : noSession()),
		write: (b, key) =>
			api
				? api.budget.setStyle(b, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out || !picked) return;
		announce({
			message: t("toast", { style: t(`name.${picked}`) }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const choices = STYLES.filter((s) => s !== current).map((s) => ({
		id: s,
		label: t(`name.${s}`),
	}));
	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
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
					submitLabel={t("submit")}
				>
					<Note>{t("now", { style: t(`name.${current}`) })}</Note>
					<ChoiceList
						choices={choices}
						onPress={(id) => setPicked(id as SwitchStyle)}
						selected={new Set(picked ? [picked] : [])}
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
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
