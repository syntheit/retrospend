import { useTranslations } from "use-intl";
import { type FigureDiff, figureLines } from "@/features/budget/figures";
import { ChangeList, type ChangeRow } from "@/features/budget/parts";
import { useFigureLabel } from "@/features/budget/useFigureLabel";
import type { PreviewStatus } from "@/features/budget/useMoneyWrite";
import { useMoneyText } from "@/features/read/useMoneyText";

type Side = { minor: number; currency: string } | null;

/**
 * What an account write would change and what it would not, from the server's
 * dry run (R30): every figure that moved (net worth and its parts), then what
 * was checked and stays. `lead` rows come first (the account's own line).
 */
export function PreviewChanges({
	preview,
	status,
	lead = [],
}: {
	preview: FigureDiff | null;
	status: PreviewStatus;
	lead?: ChangeRow[];
}) {
	const tp = useTranslations("mobile.budget.preview");
	const money = useMoneyText();
	const label = useFigureLabel();
	const lines = preview ? figureLines(preview) : null;
	const side = (value: Side) => (value ? money(value) : tp("notAvailable"));
	const changes: ChangeRow[] = [
		...lead,
		...(lines?.changes ?? []).map((change) => ({
			key: change.key,
			label: label(change.id).name,
			value: tp("beforeAfter", {
				before: side(change.before),
				after: side(change.after),
			}),
		})),
	];
	return (
		<ChangeList
			changes={changes}
			status={status}
			stays={(lines?.stays ?? []).map((id) => label(id).inline)}
			unavailable={(lines?.unavailable ?? []).map((id) => label(id).inline)}
		/>
	);
}
