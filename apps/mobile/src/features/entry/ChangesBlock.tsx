import { useTranslations } from "use-intl";
import {
	type ChangeGroup,
	ChangeList,
	type ChangeRow,
	type ChangeStatus,
} from "@/ui/ChangeList";
import { useChangeWords } from "./changeWords";
import {
	type ChangeLines,
	changeLines,
	type PreviewState,
	type ShareLine,
	sharesOf,
} from "./preview";

/**
 * What this changes (R30), fed from the composer's dry run: each place that
 * moves, before Save, then what stays. The numbers are the server's dry run of
 * the same write, formatted here and never computed. A total the server
 * converted at reference rates reads with the approximate mark. A
 * split-expense edit also says whose share moves, from the same dry run.
 * Offline there is no dry run, and the block says the write waits on the
 * phone. The layout is the shared ChangeList; this only words the composer's
 * shape for it.
 */
export function ChangesBlock({
	state,
	idle,
	onRetry,
}: {
	state: PreviewState;
	/** What to say before there is anything to preview. */
	idle: string;
	/** Asks the server again after an offline or refused dry run. */
	onRetry?: () => void;
}) {
	const t = useTranslations("mobile.composer.changes");
	const { money, marked, name } = useChangeWords();
	const lines: ChangeLines | null =
		state.status === "ready" ? changeLines(state.diff) : null;
	const shares: ShareLine[] | null =
		state.status === "ready" ? sharesOf(state.diff) : null;
	const shareText = (s: ShareLine) =>
		s.before && s.after
			? t("shares.change", { before: money(s.before), after: money(s.after) })
			: s.after
				? t("shares.joins", { after: money(s.after) })
				: t("shares.leaves", { before: s.before ? money(s.before) : "" });

	const changes: ChangeRow[] = (lines?.moved ?? []).map((line) => ({
		key: line.key,
		label: name(line.figure, false),
		value: marked(money(line.delta, "exceptZero"), line.approx),
		detail: line.after
			? t("to", { amount: marked(money(line.after), line.approx) })
			: undefined,
	}));
	const groups: ChangeGroup[] = [];
	if (shares && shares.length > 0) {
		groups.push({
			key: "shares",
			title: t("shares.title"),
			rows: shares.map((s) => ({
				key: s.key,
				label: s.you ? t("shares.you") : s.name,
				value: shareText(s),
			})),
			note: t("shares.told"),
		});
	} else if (shares) {
		groups.push({ key: "shares", rows: [], note: t("shares.same") });
	}

	let status: ChangeStatus = "ready";
	let message: string | undefined;
	switch (state.status) {
		case "idle":
			status = "idle";
			message = idle || undefined;
			break;
		case "loading":
			status = "loading";
			break;
		case "offline":
			message = t("offline");
			break;
		case "refused":
			status = "refused";
			message =
				state.reason === "missingRate"
					? t("noRate", { currency: state.currency })
					: state.reason === "split"
						? t("splitOff")
						: t("refused");
			break;
		case "ready":
			break;
	}
	const retry =
		state.status === "offline" || state.status === "refused"
			? onRetry
			: undefined;
	return (
		<ChangeList
			changes={changes}
			groups={groups}
			message={message}
			onRetry={retry}
			status={status}
			stays={(lines?.stays ?? []).map((id) => name(id, true))}
			unavailable={(lines?.unknown ?? []).map((id) => name(id, true))}
		/>
	);
}
