import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { projectLines } from "./deleteLines";

type Consequences = Awaited<
	ReturnType<RetrospendClient["account"]["deletionPreview"]>
>;

/** What the server said went wrong, in its own words when it gave some. */
function detailOf(error: unknown): string | null {
	const message = (error as { message?: unknown } | null)?.message;
	return typeof message === "string" && message !== "" ? message : null;
}

/**
 * Deleting your account for good. The sheet first says what it changes for
 * other people (projects handed over or deleted, payments and shares settled
 * on your way out: the server's own read), then asks for the password, every
 * time. There is no undo, so the sheet says so. Admins and accounts without
 * a password get the server's refusal as it words it.
 */
export function DeleteAccountSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.settings.delete");
	const tc = useTranslations("mobile.common");
	const { api, signOut } = useSession();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [what, setWhat] = useState<Consequences | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	const key = useRef(newClientId());

	// Each opening reads what deleting would change, and starts with no password.
	useEffect(() => {
		if (!visible || !api) return;
		let cancelled = false;
		setWhat(null);
		setLoadFailed(false);
		setPassword("");
		setRefusal(null);
		key.current = newClientId();
		api.account
			.deletionPreview()
			.then((read) => !cancelled && setWhat(read))
			.catch(() => !cancelled && setLoadFailed(true));
		return () => {
			cancelled = true;
		};
	}, [visible, api]);

	async function remove() {
		if (!api || busy || password === "") return;
		setBusy(true);
		setRefusal(null);
		try {
			await api.account.delete(
				{ password },
				{ context: { idempotencyKey: key.current } },
			);
			onClose();
			// The server ended every session; this clears the phone's own.
			await signOut({ discardUnsynced: true });
		} catch (error) {
			setRefusal(detailOf(error) ?? t("error"));
		} finally {
			setBusy(false);
		}
	}

	const line = (text: string) => <Text key={text}>{text}</Text>;
	const lines = what
		? [
				...projectLines(what, t),
				...(what.settlementsToAutoConfirm > 0
					? [t("confirm", { count: what.settlementsToAutoConfirm })]
					: []),
				...(what.settlementsToCancel > 0
					? [t("cancel", { count: what.settlementsToCancel })]
					: []),
				...(what.verificationsToAutoAccept > 0
					? [t("accept", { count: what.verificationsToAutoAccept })]
					: []),
				...(what.sharedTransactionsToAnonymize > 0
					? [t("anonymize", { count: what.sharedTransactionsToAnonymize })]
					: []),
			]
		: [];

	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						busy={busy}
						disabled={busy || password === "" || what === null}
						label={busy ? t("deleting") : t("delete")}
						onPress={remove}
						variant="danger"
					/>
				</>
			}
			footerApart
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				<Text tone="fg2">{t("permanent")}</Text>
				{loadFailed ? (
					<Text tone="attention">{t("loadError")}</Text>
				) : what === null ? (
					<Text tone="fg2">{t("checking")}</Text>
				) : (
					<View style={{ gap: space[2] }}>
						<Text
							accessibilityRole="header"
							tone="fg2"
							variant="small"
							weight="semibold"
						>
							{t("changes")}
						</Text>
						{lines.length === 0 ? line(t("nothing")) : lines.map(line)}
					</View>
				)}
				<TextField
					autoComplete="current-password"
					label={t("password")}
					onChangeText={setPassword}
					secure
					value={password}
				/>
				{refusal ? (
					<Text accessibilityRole="alert" tone="danger">
						{refusal}
					</Text>
				) : null}
			</ScrollView>
		</Sheet>
	);
}
