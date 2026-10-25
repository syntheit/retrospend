import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";

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
	const { api, signOut } = useSession();
	const { color, radius, size, space, type } = useTheme();
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

	const line = (text: string) => (
		<Text key={text} style={{ color: color.fg, fontSize: type.body.size }}>
			{text}
		</Text>
	);
	const lines = what
		? [
				...what.projectsToTransfer.map((p) =>
					t("transfer", { project: p.name, name: p.newOrganizerName }),
				),
				...what.projectsToDelete.map((p) =>
					t("deleteProject", { project: p.name }),
				),
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
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("permanent")}
				</Text>
				{loadFailed ? (
					<Text
						style={{ color: color.attentionText, fontSize: type.body.size }}
					>
						{t("loadError")}
					</Text>
				) : what === null ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{t("checking")}
					</Text>
				) : (
					<View style={{ gap: space[2] }}>
						<Text
							accessibilityRole="header"
							style={{
								color: color.fg2,
								fontSize: type.small.size,
								fontWeight: "600",
							}}
						>
							{t("changes")}
						</Text>
						{lines.length === 0 ? line(t("nothing")) : lines.map(line)}
					</View>
				)}
				<View style={{ gap: space[2] }}>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("password")}
					</Text>
					<TextInput
						accessibilityLabel={t("password")}
						autoCapitalize="none"
						autoComplete="current-password"
						autoCorrect={false}
						onChangeText={setPassword}
						secureTextEntry
						style={{
							minHeight: size.moneyInput.phone,
							paddingHorizontal: space[3],
							borderRadius: radius.ctl,
							borderWidth: 1,
							borderColor: color.lineStrong,
							backgroundColor: color.surface,
							color: color.fg,
							fontSize: type.body.size,
						}}
						value={password}
					/>
				</View>
				{refusal ? (
					<Text
						accessibilityRole="alert"
						style={{ color: color.danger, fontSize: type.body.size }}
					>
						{refusal}
					</Text>
				) : null}
				<Button
					disabled={busy || password === "" || what === null}
					label={busy ? t("deleting") : t("delete")}
					onPress={remove}
				/>
			</ScrollView>
		</Sheet>
	);
}
