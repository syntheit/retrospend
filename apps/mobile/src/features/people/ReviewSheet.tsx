import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import type { LedgerRow } from "./PersonSections";
import type { NeedsItem, PersonIdentity } from "./source";

export type ReviewNeed = Extract<NeedsItem, { kind: "verify" }>;

/**
 * Answering a split somebody added you to: what it is, your share, and
 * what it does between you (the server's own figure from the person's
 * ledger), then Accept or Reject. API v1 has no dry run and no undo for
 * these two writes yet, so the sheet says who is told and the toast has no
 * Undo (listed as an API gap).
 */
export function ReviewSheet({
	person,
	need,
	row,
	visible,
	onClose,
	onDone,
}: {
	person: PersonIdentity;
	need: ReviewNeed;
	/** The ledger row of this expense, when the page carries it. */
	row: LedgerRow | undefined;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.review");
	const { api } = useSession();
	const toast = useToast();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
	const [failed, setFailed] = useState(false);
	// One key per answer, so a retry after a dropped connection replays.
	const keys = useRef({ accept: newClientId(), reject: newClientId() });
	const first = person.name.split(/\s+/)[0] ?? person.name;

	async function answer(kind: "accept" | "reject") {
		if (!api || busy) return;
		setBusy(kind);
		setFailed(false);
		try {
			const context = { idempotencyKey: keys.current[kind] };
			const shared = api["shared-expenses"];
			if (kind === "accept") await shared.accept({ id: need.id }, { context });
			else await shared.reject({ id: need.id }, { context });
			onClose();
			onDone();
			toast.show({
				message:
					kind === "accept" ? t("accepted") : t("rejected", { name: first }),
			});
		} catch {
			setFailed(true);
		} finally {
			setBusy(null);
		}
	}

	const effect = row?.effect
		? row.effect.minor > 0
			? t("effectThem", {
					name: first,
					amount: money({
						minor: row.effect.minor,
						currency: row.effect.currency,
					}),
				})
			: t("effectYou", {
					name: first,
					amount: money({
						minor: Math.abs(row.effect.minor),
						currency: row.effect.currency,
					}),
				})
		: null;

	const line = (label: string, value: string) => (
		<View
			accessibilityLabel={`${label}, ${value}`}
			accessible
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: space[3],
			}}
		>
			<Text style={{ color: color.fg2, fontSize: type.body.size }}>
				{label}
			</Text>
			<Text
				style={{
					flexShrink: 1,
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</View>
	);

	return (
		<Sheet
			detents={["medium"]}
			onClose={onClose}
			title={t("title", { name: first })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
			>
				<Text
					style={{
						color: color.fg,
						fontSize: type.title.size,
						fontWeight: "600",
					}}
				>
					{need.title}
				</Text>
				<View style={{ gap: space[2] }}>
					{line(t("yourShare"), money(need.amount))}
					{effect ? line(t("betweenYou"), effect) : null}
				</View>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("rejectNote", { name: first })}
				</Text>
				{failed ? (
					<Text
						style={{ color: color.attentionText, fontSize: type.body.size }}
					>
						{t("error")}
					</Text>
				) : null}
				<Button
					disabled={busy !== null}
					label={busy === "accept" ? t("saving") : t("accept")}
					onPress={() => answer("accept")}
				/>
				<Button
					disabled={busy !== null}
					label={busy === "reject" ? t("saving") : t("reject")}
					onPress={() => answer("reject")}
					variant="outlined"
				/>
			</ScrollView>
		</Sheet>
	);
}
