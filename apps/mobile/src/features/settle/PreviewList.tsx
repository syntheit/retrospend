import type { Money } from "@retrospend/domain/money-minor";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { ChangeList } from "@/ui/ChangeList";
import type { PaymentPreview } from "./plan";
import { previewRows } from "./plan";

/**
 * What the payment would change and what it would not, from the server's
 * own dry run of the write (R30). The sheet words the figures; it never
 * computes them. The layout is the shared ChangeList.
 */
export function PreviewList({
	preview,
	name,
}: {
	preview: PaymentPreview;
	name: string;
}) {
	const t = useTranslations("mobile.settle");
	const tm = useTranslations("mobile.money");
	const tc = useTranslations("mobile.changes");
	const money = useMoneyText();
	// A converted total is an estimate at reference rates: it reads "≈".
	const format = (amount: Money, approx: boolean) =>
		approx ? tm("approx", { amount: money(amount) }) : money(amount);
	const { changes, kept } = previewRows(preview);

	const label = (figure: string) =>
		t(`figure.${figure.replace(".", "_")}` as "figure.balance_person", {
			name,
		});

	return (
		<ChangeList
			changes={changes.map((c) => ({
				key: `${c.figure}:${c.currency}`,
				label: label(c.figure),
				value: t("beforeAfter", {
					before: c.before ? format(c.before, c.approx) : t("none"),
					after: c.after ? format(c.after, c.approx) : t("none"),
				}),
			}))}
			holds={kept.map((k) => ({
				key: k.figure,
				label: label(k.figure),
				value:
					k.lines.length > 0
						? k.lines
								.map((line) => tc("keeps", { amount: format(line, k.approx) }))
								.join(", ")
						: t("none"),
			}))}
			status="ready"
		/>
	);
}
