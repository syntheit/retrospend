import {
	PASSWORD_CHECKS,
	passwordChecks,
	passwordReady,
} from "@retrospend/api-contract";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import {
	isKeyedAccount,
	keysLookup,
	type RotateFailure,
	rotatePassword,
} from "@/auth/sign-in-secret";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Glyph } from "@/ui/Glyph";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

/** The status of a refused change, read from the server's problem. */
function statusOf(error: unknown): number | null {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" ? status : null;
}

/** The stable problem code of a refused change (an account with protection keys). */
function codeOf(error: unknown): string | null {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : null;
}

/** The sheet's words for a refused rotation. */
function rotateRefusal(
	reason: RotateFailure,
): "wrong" | "tooMany" | "keysMissing" | "protected" | "error" {
	return reason === "wrongPassword"
		? "wrong"
		: reason === "rateLimited"
			? "tooMany"
			: reason === "keysMissing"
				? "keysMissing"
				: reason === "unavailable"
					? "protected"
					: "error";
}

/**
 * Change password: the current one, the new one with its rules as checks,
 * and the new one again. The server checks the current password every time
 * and signs out the other devices; this phone stays signed in. An account with
 * protection keys changes it on this phone (derive, rewrap, check, send), the
 * same sheet with its busy state. Nothing typed stays in a closed sheet.
 */
export function PasswordSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.settings.security.password");
	// Keys that a reset removed: the sign-in screen's words, final here too.
	const tSignIn = useTranslations("mobile.signIn.error");
	const { api, baseUrl, state } = useSession();
	const email = state.status === "signedIn" ? (state.me?.email ?? null) : null;
	const userId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
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
			if (!baseUrl || !email || !userId) {
				setRefusal(t("error"));
				return;
			}
			// The plain route refuses a keyed account, but not before the typed
			// password has travelled: ask first, and a keyed account takes the
			// rotation, which sends only sign-in secrets.
			const keyed = await isKeyedAccount({
				baseUrl,
				email,
				lookup: keysLookup(api),
			});
			if (keyed === null) {
				setRefusal(t("error"));
				return;
			}
			if (keyed) {
				const done = await rotatePassword({
					api: api.protection,
					baseUrl,
					email,
					userId,
					current,
					next,
					lookup: keysLookup(api),
					newKey: newClientId,
				});
				if (!done.ok) {
					const words = rotateRefusal(done.reason);
					setRefusal(
						words === "keysMissing" ? tSignIn("keysMissing") : t(words),
					);
					return;
				}
				onClose();
				toast.show({ message: t("changed") });
				return;
			}
			await api.account.changePassword(
				{ currentPassword: current, newPassword: next },
				{ context: { idempotencyKey: key.current } },
			);
			onClose();
			toast.show({ message: t("changed") });
		} catch (error) {
			const status = statusOf(error);
			setRefusal(
				codeOf(error) === "protected_password"
					? t("protected")
					: status === 429
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
							<Text tone={checks[c] ? "fg" : "fg3"} variant="small">
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
					<Text accessibilityRole="alert" tone="danger" variant="small">
						{t("mismatch")}
					</Text>
				) : null}
				{refusal ? (
					<Text accessibilityRole="alert" tone="danger">
						{refusal}
					</Text>
				) : null}
				<Button
					busy={busy}
					disabled={busy || !ready}
					label={busy ? t("saving") : t("submit")}
					onPress={submit}
					variant="filled"
				/>
			</ScrollView>
		</Sheet>
	);
}
