import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { ChangeList, type ChangeRow } from "./parts";
import { previewRows } from "./preview";
import { type BudgetMonth, type BudgetPreview, envelopeById } from "./source";
import type { PreviewStatus } from "./useMoneyWrite";

/**
 * The server's dry run of a budget write, worded: each envelope's Left, the
 * pool, and Left to spend (changed, or what stays). Nothing is added up here;
 * every amount is a field of the preview.
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
	const rows = preview ? previewRows(preview) : null;
	const pairText = (before: string, after: string) =>
		t("preview.beforeAfter", { before, after });
	const none = t("preview.none");

	const changes: ChangeRow[] = [];
	const stays: ChangeRow[] = [];
	if (rows) {
		for (const move of rows.envelopes) {
			if (move.before.minor === move.after.minor) continue;
			const name =
				envelopeById(data, move.id)?.name ?? t("preview.envelopeFallback");
			const label = t("preview.leftOf", { name });
			const value = pairText(money(move.before), money(move.after));
			changes.push({
				key: `e:${move.id}`,
				label,
				value,
				spoken: `${label}, ${value}`,
			});
		}
		// A Limits book has no pool on screen, so its movement is not a line either.
		if (rows.pool && data.book.style !== "LIMITS") {
			const label = t(`pool.${data.toAssign.poolName}`);
			const value = pairText(
				rows.pool.before ? money(rows.pool.before) : none,
				rows.pool.after ? money(rows.pool.after) : none,
			);
			changes.push({ key: "pool", label, value, spoken: `${label}, ${value}` });
		}
		if (rows.leftToSpend && "change" in rows.leftToSpend) {
			const { before, after } = rows.leftToSpend.change;
			const label = t("preview.leftToSpend");
			const value = pairText(
				before ? money(before) : none,
				after ? money(after) : none,
			);
			changes.push({ key: "left", label, value, spoken: `${label}, ${value}` });
		} else if (rows.leftToSpend && rows.leftToSpend.stays.length > 0) {
			const label = t("preview.leftToSpend");
			const value = rows.leftToSpend.stays
				.map((line) => t("preview.keeps", { amount: money(line) }))
				.join(", ");
			stays.push({ key: "left", label, value, spoken: `${label}, ${value}` });
		}
	}
	return (
		<ChangeList
			changes={changes}
			nothing={t("preview.nothing")}
			status={status}
			stays={stays}
		/>
	);
}
