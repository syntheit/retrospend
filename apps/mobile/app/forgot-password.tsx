import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { ForgotPasswordScreen } from "@/features/recovery/ForgotPasswordScreen";
import { HEADER_TITLE_FACE, LARGE_TITLE } from "@/layout/pushedHeader";

/** Forgot password: the code, then the recovery key. The sign-in screen opens it with the email typed so far. */
export default function ForgotPasswordRoute() {
	const t = useTranslations("mobile.recovery");
	const { email } = useLocalSearchParams<{ email?: string }>();
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
			<ForgotPasswordScreen initialEmail={email ?? ""} />
		</>
	);
}
