import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { figureLines } from "./figures";
import { ChangeList, type ChangeRow } from "./parts";
import { envelopeMoves, hiddenFor } from "./preview";
import { type BudgetMonth, type BudgetPreview, envelopeById } from "./source";
import { useFigureLabel } from "./useFigureLabel";
import type { PreviewStatus } from "./useMoneyWrite";

/**
 * The server's dry run of a budget write, laid out like the web's block:
 * each envelope's Left, every figure that moved (the pool, Left to spend,
 * Left in your limits, what the budget holds...), what was checked and stays,
 * and what could not be checked. Nothing is added up here; every amount is a
 * field of the preview.
 */
export function BudgetChanges({
	status,
	preview,
	data,
}: {
	status: PreviewStatus;
	preview: BudgetPreview | null;
	data: BudgetMonth;
}) {
	const t = useTranslations("mobile.budget");
	const money = useMoneyText();
	const label = useFigureLabel(t(`pool.${data.toAssign.poolName}`));
	const side = (value: { minor: number; currency: string } | null) =>
		value ? money(value) : t("preview.notAvailable");
	const pair = (
		before: { minor: number; currency: string } | null,
		after: { minor: number; currency: string } | null,
	) => t("preview.beforeAfter", { before: side(before), after: side(after) });

	const moves = preview ? envelopeMoves(preview) : [];
	const lines = preview ? figureLines(preview, hiddenFor(moves)) : null;
	const rows: ChangeRow[] = [];
	for (const move of moves) {
		if (move.before.minor === move.after.minor) continue;
		const name =
			envelopeById(data, move.id)?.name ?? t("preview.envelopeFallback");
		const text = t("preview.leftOf", { name });
		const value = pair(move.before, move.after);
		rows.push({
			key: `e:${move.id}`,
			label: text,
			value,
			spoken: `${text}, ${value}`,
		});
	}
	for (const change of lines?.changes ?? []) {
		const name = label(change.id).name;
		const value = pair(change.before, change.after);
		rows.push({
			key: change.key,
			label: name,
			value,
			spoken: `${name}, ${value}`,
		});
	}
	return (
		<ChangeList
			changes={rows}
			status={status}
			stays={(lines?.stays ?? []).map((id) => label(id).inline)}
			unavailable={(lines?.unavailable ?? []).map((id) => label(id).inline)}
		/>
	);
}
