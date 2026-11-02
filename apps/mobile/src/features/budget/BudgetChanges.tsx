import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { figureLines } from "@/features/write/figures";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import type { PreviewStatus } from "@/features/write/useMoneyWrite";
import { ChangeList, type ChangeRow } from "@/ui/ChangeList";
import { Text } from "@/ui/Text";
import { envelopeMoves, hiddenFor } from "./preview";
import { type BudgetMonth, type BudgetPreview, envelopeById } from "./source";

/**
 * The rows of a budget write's dry run, laid out like the web's block: each
 * envelope's Left, then every figure that moved (the pool, Left to spend,
 * Left in your limits, what the budget holds...), plus what was checked and
 * stays and what could not be checked. Nothing is added up here; every amount
 * is a field of the preview.
 */
export function useChangeRows(
	preview: BudgetPreview | null,
	data: BudgetMonth | null,
) {
	const t = useTranslations("mobile.budget");
	const money = useMoneyText();
	const label = useFigureLabel({
		poolName: t(`pool.${data?.toAssign.poolName ?? "NOT_PLANNED_YET"}`),
	});
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
			(data ? envelopeById(data, move.id)?.name : undefined) ??
			t("preview.envelopeFallback");
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
	return {
		rows,
		stays: (lines?.stays ?? []).map((id) => label(id).inline),
		unavailable: (lines?.unavailable ?? []).map((id) => label(id).inline),
	};
}

/**
 * The server's dry run of a budget write as the full block: every row that
 * moved, what stays and what could not be checked.
 */
export function BudgetChanges({
	status,
	preview,
	data,
}: {
	status: PreviewStatus;
	preview: BudgetPreview | null;
	/** Null before there is a budget (set up): no envelope names. */
	data: BudgetMonth | null;
}) {
	const { rows, stays, unavailable } = useChangeRows(preview, data);
	return (
		<ChangeList
			changes={rows}
			status={status}
			stays={stays}
			unavailable={unavailable}
		/>
	);
}

/**
 * The same dry run in one line, the way the composer's preview line says it:
 * the first row that moves ("Left of Groceries $80 to $100") and how many more
 * move. Before the answer, before there is a body to check and when nothing
 * moves it says nothing.
 */
export function BudgetPreviewLine({
	status,
	preview,
	data,
}: {
	status: PreviewStatus;
	preview: BudgetPreview | null;
	data: BudgetMonth | null;
}) {
	const t = useTranslations("mobile.composer.changes");
	const tc = useTranslations("mobile.changes");
	const { rows } = useChangeRows(preview, data);
	if (status === "idle" || status === "loading") return null;
	let text: string;
	let tone: "fg2" | "attention" = "fg2";
	if (status === "failed" || status === "refused") {
		tone = "attention";
		text = tc(status === "failed" ? "error" : "refused");
	} else {
		const first = rows[0];
		if (!first) return null;
		text =
			rows.length > 1
				? t("oneLineMore", {
						figure: `${first.label} ${first.value}`,
						count: rows.length - 1,
					})
				: `${first.label} ${first.value}`;
	}
	return (
		<Text
			accessibilityLiveRegion="polite"
			numberOfLines={1}
			style={{ textAlign: "center" }}
			tabular
			tone={tone}
			variant="small"
		>
			{text}
		</Text>
	);
}
