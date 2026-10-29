import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Glyph } from "@/ui/Glyph";
import { Sheet } from "@/ui/Sheet";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { PASSWORD_CHECKS, passwordChecks, passwordReady } from "./rules";

/** The status of a refused change, read from the server's problem. */
function statusOf(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" ? status : null;
}

/**
 * Change password: the current one, the new one with its rules as checks,
 * and the new one again. The server checks the current password every time
 * and signs out the other devices; this phone stays signed in. Nothing typed
 * stays in a closed sheet.
 */
export function PasswordSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.settings.security.password");
	const { api } = useSession();
	const toast = useToast();
	const { color, space, type } = useTheme();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	const key = useRef(newClientId());

	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the trigger
	useEffect(() => {
		setCurrent("");
		setNext("");
		setConfirm("");
		setRefusal(null);
		key.current = newClientId();
	}, [visible]);

	const checks = passwordChecks(next);
	const ready = passwordReady({ current, next, confirm });

	async function submit() {
		if (!api || busy || !ready) return;
		setBusy(true);
		setRefusal(null);
		try {
			await api.account.changePassword(
				{ currentPassword: current, newPassword: next },
				{ context: { idempotencyKey: key.current } },
			);
			onClose();
			toast.show({ message: t("changed") });
		} catch (error) {
			const status = statusOf(error);
			setRefusal(
				status === 429
					? t("tooMany")
					: status === 400
						? t("wrong")
						: t("error"),
			);
			// A refused try used its key; the next try is a new request.
			key.current = newClientId();
		} finally {
			setBusy(false);
		}
	}

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
				<TextField
					autoComplete="current-password"
					label={t("current")}
					onChangeText={setCurrent}
					secure
					value={current}
				/>
				<TextField
					autoComplete="new-password"
					label={t("new")}
					onChangeText={setNext}
					secure
					value={next}
				/>
				<View accessibilityLabel={t("rules")} style={{ gap: space[2] }}>
					{PASSWORD_CHECKS.map((c) => (
						<View
							accessibilityLabel={`${t(`check.${c}`)}, ${checks[c] ? t("met") : t("notMet")}`}
							accessible
							key={c}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space[2],
							}}
						>
							<View style={{ opacity: checks[c] ? 1 : 0 }}>
								<Glyph color={color.fg} name="Check" size={type.small.size} />
							</View>
							<Text
								style={{
									color: checks[c] ? color.fg : color.fg3,
									fontSize: type.small.size,
								}}
							>
								{t(`check.${c}`)}
							</Text>
						</View>
					))}
				</View>
				<TextField
					autoComplete="new-password"
					invalid={confirm !== "" && confirm !== next}
					label={t("confirm")}
					onChangeText={setConfirm}
					secure
					value={confirm}
				/>
				{confirm !== "" && confirm !== next ? (
					<Text
						accessibilityRole="alert"
						style={{ color: color.danger, fontSize: type.small.size }}
					>
						{t("mismatch")}
					</Text>
				) : null}
				{refusal ? (
					<Text
						accessibilityRole="alert"
						style={{ color: color.danger, fontSize: type.body.size }}
					>
						{refusal}
					</Text>
				) : null}
				<Button
					disabled={busy || !ready}
					label={busy ? t("saving") : t("submit")}
					onPress={submit}
					variant="filled"
				/>
			</ScrollView>
		</Sheet>
	);
}
