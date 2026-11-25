import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { PARKED_CHAIN_LOST } from "@/data/outbox-chain";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { showAlert } from "@/ui/alert";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { useToast } from "@/ui/Toast";
import { useChangeWords } from "./changeWords";
import { announceEntryChange } from "./events";
import { type RebaseOffer, useParkedEntries } from "./parked";
import { type ParkedEntry, rebases } from "./parked-entry";
import { changeLines } from "./preview";
import { PARKED_STAMP } from "./send";

/** What the row says: another device changed or deleted it, an earlier change never synced, or the server refused it. */
const lineOf = (entry: ParkedEntry) =>
	entry.gone
		? "sync.deleted"
		: entry.reason === PARKED_STAMP
			? "sync.changed"
			: entry.reason === PARKED_CHAIN_LOST
				? "sync.lost"
				: "sync.refused";

/**
 * "Couldn't sync": entries the server refused, kept on the phone. Each has
 * Try again and Discard; a row another device deleted has Discard only.
 * Try again on a row another device changed saves your change over the newer
 * version, after a dry run of it. Nothing shows when nothing is parked, so
 * Home, Activity and the composer can all put it at their top.
 */
export function SyncIssues({ padded }: { padded?: boolean }) {
	const t = useTranslations("mobile.composer");
	const td = useTranslations("mobile.composer.delete");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const { format } = useFormatMoney();
	const { money, marked } = useChangeWords();
	const label = useFigureLabel();
	const toast = useToast();
	const { entries, retry, rebase, discard } = useParkedEntries();
	// The entry being sent again: Android shows the loading indicator beside it.
	const [retrying, setRetrying] = useState<string | null>(null);
	if (entries.length === 0) return null;
	/** A delete names the row by id only: it reads as the delete it is. */
	const name = (entry: ParkedEntry) => entry.title || td("button");

	/** The dry run as the alert's one line: the first place that moves, and how many more. */
	function previewLine(offer: RebaseOffer): string | undefined {
		const [first, ...rest] = changeLines(offer.diff).moved;
		if (!first) return undefined;
		const figure = `${label(first.figure).name} ${marked(money(first.delta, "exceptZero"), first.approx)}`;
		return rest.length > 0
			? t("changes.oneLineMore", { figure, count: rest.length })
			: figure;
	}

	async function tryAgain(entry: ParkedEntry) {
		if (retrying !== null) return;
		setRetrying(entry.clientId);
		try {
			const rebased = rebases(entry);
			// A write that met a newer row is shown against that row first.
			const offer = rebased ? await rebase(entry.clientId) : null;
			if (rebased && !offer) {
				toast.show({ message: t("sync.retryFailed") });
				return;
			}
			if (offer) {
				const isDelete = offer.kind === "delete";
				showAlert(
					isDelete ? td("title") : t("sync.rebaseTitle"),
					previewLine(offer),
					[
						{ text: tc("cancel"), style: "cancel" },
						{
							text: isDelete ? td("anyway") : t("save"),
							style: isDelete ? "destructive" : "default",
							onPress: async () => {
								const sent = await offer.save();
								announceEntryChange();
								if (!sent) toast.show({ message: t("sync.retryFailed") });
							},
						},
					],
				);
				return;
			}
			const sent = await retry(entry.clientId);
			announceEntryChange();
			if (!sent) toast.show({ message: t("sync.retryFailed") });
		} finally {
			setRetrying(null);
		}
	}

	return (
		<View
			style={{
				gap: space[2],
				...(padded ? { padding: space[4] } : null),
			}}
		>
			<Text accessibilityRole="header" tone="attention" variant="section">
				{t("sync.title")}
			</Text>
			{entries.map((entry) => (
				<View key={entry.clientId} style={{ gap: space[1] }}>
					{/* One stop for what it is; Try again and Discard stay their own stops. */}
					<View accessible style={{ gap: space[1] }}>
						<View style={{ flexDirection: "row", gap: space[3] }}>
							<Text numberOfLines={1} style={{ flex: 1 }}>
								{name(entry)}
							</Text>
							{entry.amount ? (
								<Text tabular>
									{format(entry.amount, { cents: true }) ?? ""}
								</Text>
							) : null}
						</View>
						<Text tone="fg2" variant="small">
							{t(lineOf(entry))}
						</Text>
					</View>
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						{retrying === entry.clientId ? (
							<LoadingIndicator size={space[6]} />
						) : null}
						{entry.gone || !entry.retryable ? null : (
							<TextAction
								accessibilityLabel={`${tc("retry")}, ${name(entry)}`}
								label={tc("retry")}
								onPress={() => tryAgain(entry)}
							/>
						)}
						<TextAction
							accessibilityLabel={`${t("sync.discard")}, ${name(entry)}`}
							label={t("sync.discard")}
							onPress={async () => {
								await discard(entry.clientId);
								toast.show({
									message: t("toast.discarded", { title: name(entry) }),
								});
							}}
							tone="danger"
						/>
					</View>
				</View>
			))}
		</View>
	);
}
