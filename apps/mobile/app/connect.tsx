import { Button } from "@expo/ui";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import {
	DEFAULT_SERVER,
	type ProbeResult,
	probeServer,
} from "@/lib/server-info";
import { useTheme } from "@/theme";
import { NativeHost } from "@/ui/NativeHost";
import { Screen } from "@/ui/Screen";

type Failure = Extract<ProbeResult, { ok: false }>["reason"];

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

export default function ConnectScreen() {
	const t = useTranslations("mobile.connect");
	const { color, space, radius, size, type } = useTheme();
	const { connect } = useServerConnection();
	const [address, setAddress] = useState(new URL(DEFAULT_SERVER).host);
	const [checking, setChecking] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);

	async function submit() {
		if (checking) return;
		setChecking(true);
		setFailure(null);
		const result = await probeServer(address, APP_VERSION);
		if (result.ok) {
			await connect(result.baseUrl);
		} else {
			setFailure(result.reason);
			setChecking(false);
		}
	}

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
				<Text
					style={{
						color: color.fg2,
						fontSize: type.body.size,
						lineHeight: type.body.size * type.body.lineHeight,
					}}
				>
					{t("intro")}
				</Text>
				<View style={{ gap: space[2] }}>
					<Text style={{ color: color.fg, fontSize: type.small.size }}>
						{t("urlLabel")}
					</Text>
					<TextInput
						accessibilityLabel={t("urlLabel")}
						autoCapitalize="none"
						autoComplete="url"
						autoCorrect={false}
						editable={!checking}
						inputMode="url"
						keyboardType="url"
						onChangeText={setAddress}
						onSubmitEditing={submit}
						returnKeyType="go"
						style={{
							minHeight: size.touchMin.phone,
							paddingHorizontal: space[3],
							borderRadius: radius.ctl,
							borderWidth: 1,
							borderColor: failure ? color.danger : color.lineStrong,
							backgroundColor: color.surface,
							color: color.fg,
							fontSize: type.section.size,
						}}
						textContentType="URL"
						value={address}
					/>
					{failure ? (
						<Text
							accessibilityLiveRegion="polite"
							accessibilityRole="alert"
							style={{ color: color.danger, fontSize: type.small.size }}
						>
							{t(failure)}
						</Text>
					) : null}
				</View>
				<NativeHost>
					<Button
						disabled={checking}
						label={checking ? t("checking") : t("submit")}
						onPress={submit}
					/>
				</NativeHost>
			</Screen>
		</>
	);
}
