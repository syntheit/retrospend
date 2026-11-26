import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { type FigureDiff, figureLines } from "@/features/write/figures";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import type { PreviewStatus } from "@/features/write/useMoneyWrite";
import { ChangeList, type ChangeRow } from "@/ui/ChangeList";

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
	message,
}: {
	preview: FigureDiff | null;
	status: PreviewStatus;
	lead?: ChangeRow[];
	/** Shown instead of the lines (offline: the write waits on the phone). */
	message?: string;
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
			message={message}
			status={message ? "idle" : status}
			stays={(lines?.stays ?? []).map((id) => label(id).inline)}
			unavailable={(lines?.unavailable ?? []).map((id) => label(id).inline)}
		/>
	);
}
