import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { HEADER_TITLE_FACE, LARGE_TITLE } from "@/layout/pushedHeader";
import {
	initialServerAddress,
	type ProbeResult,
	probeServer,
} from "@/lib/server-info";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Failure = Extract<ProbeResult, { ok: false }>["reason"] | "saveFailed";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

export default function ConnectScreen() {
	const t = useTranslations("mobile.connect");
	const { space } = useTheme();
	const { connect } = useServerConnection();
	const [address, setAddress] = useState(() =>
		initialServerAddress(Constants.expoConfig?.extra?.defaultServer),
	);
	const [checking, setChecking] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	// A plain http server that answered; saved only after "Continue anyway".
	const [insecureUrl, setInsecureUrl] = useState<string | null>(null);

	async function save(baseUrl: string) {
		try {
			await connect(baseUrl);
		} catch {
			setFailure("saveFailed");
			setChecking(false);
		}
	}

	async function submit() {
		if (checking) return;
		setChecking(true);
		setFailure(null);
		setInsecureUrl(null);
		const result = await probeServer(address, APP_VERSION);
		if (!result.ok) {
			setFailure(result.reason);
			setChecking(false);
		} else if (result.insecure) {
			setInsecureUrl(result.baseUrl);
			setChecking(false);
		} else {
			await save(result.baseUrl);
		}
	}

	function continueInsecure() {
		if (!insecureUrl || checking) return;
		setChecking(true);
		save(insecureUrl);
	}

	function edit(text: string) {
		setAddress(text);
		setInsecureUrl(null);
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
				<Text tone="fg2">{t("intro")}</Text>
				<View style={{ gap: space[2] }}>
					<TextField
						autoComplete="url"
						disabled={checking}
						inputMode="url"
						invalid={!!failure}
						keyboardType="url"
						label={t("urlLabel")}
						onChangeText={edit}
						onSubmitEditing={submit}
						returnKeyType="go"
						textContentType="URL"
						value={address}
					/>
					{failure ? (
						<Text
							accessibilityLiveRegion="polite"
							accessibilityRole="alert"
							tone="danger"
							variant="small"
						>
							{t(failure)}
						</Text>
					) : null}
					{insecureUrl ? (
						<Text
							accessibilityLiveRegion="polite"
							accessibilityRole="alert"
							tone="attention"
							variant="small"
						>
							{t("insecureWarning")}
						</Text>
					) : null}
				</View>
				{insecureUrl ? (
					<Button
						disabled={checking}
						label={t("continueAnyway")}
						onPress={continueInsecure}
						variant="outlined"
					/>
				) : (
					<Button
						disabled={checking}
						label={checking ? t("checking") : t("submit")}
						onPress={submit}
					/>
				)}
			</Screen>
		</>
	);
}
