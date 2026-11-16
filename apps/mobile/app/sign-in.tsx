import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import type { AuthFailure } from "@/auth/errors";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { forgetKeyed } from "@/auth/sign-in-secret";
import { openWebPage } from "@/features/settings/webPages";
import { HEADER_TITLE_FACE, LARGE_TITLE } from "@/layout/pushedHeader";
import { TEST_IDS } from "@/lib/testIds";
import { useTheme } from "@/theme";
import { showAlert } from "@/ui/alert";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Step = "password" | "code";

// Password managers find the fields by their autofill hints, not their
// labels. Android gets "username" (the hint managers key on; "email" maps to
// the emailAddress hint) and "password", iOS gets textContentType. The app is
// tied to the server's domain by /.well-known/assetlinks.json (Android) and
// apple-app-site-association (iOS).
export default function SignInScreen() {
	const t = useTranslations("mobile.signIn");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const { connection, disconnect } = useServerConnection();
	const { state, signIn, verifyCode } = useSession();
	const [step, setStep] = useState<Step>("password");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<AuthFailure | null>(null);

	const expired = state.status === "signedOut" && state.expired;
	const host =
		connection.status === "connected" ? new URL(connection.baseUrl).host : "";

	async function submit() {
		if (busy) return;
		setBusy(true);
		setFailure(null);
		const result =
			step === "password"
				? await signIn(email.trim(), password)
				: await verifyCode(code);
		setBusy(false);
		if (result.status === "twoFactor") setStep("code");
		else if (result.status === "error") setFailure(result.reason);
	}

	// Offered only when the server definitely says an account this phone saw
	// with protection keys has none now (a reset removed them). Confirming
	// forgets the record, so the retry sends the typed password.
	function askNewPassword() {
		if (connection.status !== "connected") return;
		const { baseUrl } = connection;
		showAlert(t("resetConfirm"), undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("submit"),
				onPress: () => {
					void (async () => {
						try {
							await forgetKeyed(baseUrl, email.trim());
						} catch {
							return;
						}
						await submit();
					})();
				},
			},
		]);
	}

	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					headerLargeTitle: LARGE_TITLE,
					headerShadowVisible: false,
					...HEADER_TITLE_FACE,
					title: t("title"),
				}}
			/>
			<Screen>
				<Text tone="fg2">{expired ? t("expired") : t("intro", { host })}</Text>
				{step === "password" ? (
					<View style={{ gap: space[3] }}>
						<TextField
							autoComplete="username"
							disabled={busy}
							inputMode="email"
							invalid={!!failure}
							keyboardType="email-address"
							label={t("email")}
							onChangeText={(text) => {
								setEmail(text);
								// "I reset my password" acts only on the email that was refused.
								setFailure(null);
							}}
							returnKeyType="next"
							testID={TEST_IDS.signIn.email}
							textContentType="username"
							value={email}
						/>
						<TextField
							autoComplete="current-password"
							disabled={busy}
							invalid={!!failure}
							label={t("password")}
							onChangeText={setPassword}
							onSubmitEditing={submit}
							returnKeyType="go"
							secure
							testID={TEST_IDS.signIn.password}
							textContentType="password"
							value={password}
						/>
					</View>
				) : (
					<View style={{ gap: space[2] }}>
						<TextField
							autoComplete={
								Platform.OS === "android" ? "2fa-app-otp" : "one-time-code"
							}
							disabled={busy}
							inputMode="numeric"
							invalid={!!failure}
							label={t("code")}
							onChangeText={setCode}
							onSubmitEditing={submit}
							returnKeyType="go"
							textContentType="oneTimeCode"
							value={code}
						/>
						<Text tone="fg2" variant="small">
							{t("codeHint")}
						</Text>
					</View>
				)}
				{failure ? (
					<Text
						accessibilityLiveRegion="polite"
						accessibilityRole="alert"
						tone="danger"
						variant="small"
					>
						{t(`error.${failure}`)}
					</Text>
				) : null}
				{failure === "keysMissing" && step === "password" ? (
					<Button
						disabled={busy}
						label={t("resetAction")}
						onPress={askNewPassword}
						variant="text"
					/>
				) : null}
				<Button
					busy={busy}
					disabled={busy}
					label={
						busy ? t("signingIn") : t(step === "code" ? "verify" : "submit")
					}
					onPress={submit}
					testID={TEST_IDS.signIn.submit}
				/>
				{step === "password" && connection.status === "connected" ? (
					<Button
						disabled={busy}
						label={t("createAccount")}
						onPress={() => void openWebPage(connection.baseUrl, "/signup")}
						variant="text"
					/>
				) : null}
				<Button
					disabled={busy}
					label={t("changeServer")}
					onPress={disconnect}
					variant="text"
				/>
			</Screen>
		</>
	);
}
