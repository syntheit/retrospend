import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import type { AuthFailure } from "@/auth/errors";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

type Step = "password" | "code";

// Password managers find the fields by their autofill hints, not their
// labels. Android gets "username" (the hint managers key on; "email" maps to
// the emailAddress hint) and "password", iOS gets textContentType. The app is
// tied to the server's domain by /.well-known/assetlinks.json (Android) and
// apple-app-site-association (iOS).
export default function SignInScreen() {
	const t = useTranslations("mobile.signIn");
	const { color, space, radius, size, type } = useTheme();
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

	const field = {
		minHeight: size.touchMin.phone,
		paddingHorizontal: space[3],
		borderRadius: radius.ctl,
		borderWidth: 1,
		borderColor: failure ? color.danger : color.lineStrong,
		backgroundColor: color.surface,
		color: color.fg,
		fontSize: type.section.size,
	} as const;
	const label = { color: color.fg, fontSize: type.small.size } as const;

	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					headerLargeTitle: Platform.OS === "ios",
					headerShadowVisible: false,
					title: t("title"),
				}}
			/>
			<Screen>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{expired ? t("expired") : t("intro", { host })}
				</Text>
				{step === "password" ? (
					<View style={{ gap: space[3] }}>
						<View style={{ gap: space[2] }}>
							<Text style={label}>{t("email")}</Text>
							<TextInput
								accessibilityLabel={t("email")}
								autoCapitalize="none"
								autoComplete="username"
								autoCorrect={false}
								editable={!busy}
								importantForAutofill="yes"
								inputMode="email"
								keyboardType="email-address"
								onChangeText={setEmail}
								returnKeyType="next"
								style={field}
								textContentType="username"
								value={email}
							/>
						</View>
						<View style={{ gap: space[2] }}>
							<Text style={label}>{t("password")}</Text>
							<TextInput
								accessibilityLabel={t("password")}
								autoCapitalize="none"
								autoComplete="current-password"
								autoCorrect={false}
								editable={!busy}
								importantForAutofill="yes"
								onChangeText={setPassword}
								onSubmitEditing={submit}
								returnKeyType="go"
								secureTextEntry
								style={field}
								textContentType="password"
								value={password}
							/>
						</View>
					</View>
				) : (
					<View style={{ gap: space[2] }}>
						<Text style={label}>{t("code")}</Text>
						<TextInput
							accessibilityLabel={t("code")}
							autoCapitalize="none"
							autoComplete={
								Platform.OS === "android" ? "2fa-app-otp" : "one-time-code"
							}
							autoCorrect={false}
							editable={!busy}
							importantForAutofill="yes"
							inputMode="numeric"
							onChangeText={setCode}
							onSubmitEditing={submit}
							returnKeyType="go"
							style={field}
							textContentType="oneTimeCode"
							value={code}
						/>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{t("codeHint")}
						</Text>
					</View>
				)}
				{failure ? (
					<Text
						accessibilityLiveRegion="polite"
						accessibilityRole="alert"
						style={{ color: color.danger, fontSize: type.small.size }}
					>
						{t(`error.${failure}`)}
					</Text>
				) : null}
				<Button
					disabled={busy}
					label={
						busy ? t("signingIn") : t(step === "code" ? "verify" : "submit")
					}
					onPress={submit}
				/>
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
