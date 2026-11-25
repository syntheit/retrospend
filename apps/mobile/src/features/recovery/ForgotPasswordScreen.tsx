import { readResetCode } from "@retrospend/crypto";
import {
	KeyFlowError,
	type RecoveryCallbacks,
	type RecoveryFailureCode,
	type RecoveryLink,
} from "@retrospend/crypto/client";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { publicAuthApi } from "@/auth/public-api";
import {
	type CodeFailure,
	checkRecoveryLink,
	phoneRecoveryCallbacks,
	redeemResetCode,
	requestResetCode,
} from "@/auth/recovery";
import { useServerConnection } from "@/auth/server-connection";
import { openWebPage } from "@/features/settings/webPages";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { StepError } from "../settings/protection/EnableSteps";
import { RecoverSheet } from "./RecoverSheet";

type Step = "email" | "code" | "choices";

/** The words of a failure to ask for or swap a code, from the catalog. */
type Failure = CodeFailure | "expired";

/**
 * Forgot password on the phone: ask for the code the reset email carries, type
 * it, then choose how to get back in (X1) and use the recovery key (R3, R4).
 * Every answer to the request is alike, so nothing on the screen says whether
 * an account exists. The code only swaps for a recovery token: it never
 * resets a password, so the plain reset (protection off) is the web's page.
 */
export function ForgotPasswordScreen({
	initialEmail,
}: {
	initialEmail: string;
}) {
	const t = useTranslations("mobile.recovery");
	const tc = useTranslations("mobile.common");
	const ts = useTranslations("mobile.signIn");
	const p = useTranslations("protection");
	const { space } = useTheme();
	const router = useRouter();
	const toast = useToast();
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const api = useMemo(() => (baseUrl ? publicAuthApi(baseUrl) : null), [baseUrl]);

	const [step, setStep] = useState<Step>("email");
	const [email, setEmail] = useState(initialEmail);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [link, setLink] = useState<RecoveryLink | null>(null);
	const [sheet, setSheet] = useState(false);

	// One set of callbacks for the sheet's life: it remembers the handles it made.
	const callbacks = useMemo<RecoveryCallbacks | null>(
		() => (api && token ? phoneRecoveryCallbacks(api, token) : null),
		[api, token],
	);

	const words = (reason: Failure) => {
		switch (reason) {
			case "network":
				return ts("error.network");
			case "failed":
				return p("errors.failed");
			case "expired":
				return t("expired");
			default:
				return t(`errors.${reason}`);
		}
	};

	async function send() {
		if (!api || busy) return;
		setBusy(true);
		setFailure(null);
		const sent = await requestResetCode(api, email);
		setBusy(false);
		if (sent.ok) {
			setCode("");
			setStep("code");
		} else setFailure(sent.reason);
	}

	async function redeem() {
		if (!api || busy) return;
		// Text that cannot be a code is refused here, so it spends no try.
		if (readResetCode(code) === null) return setFailure("typo");
		setBusy(true);
		setFailure(null);
		const swapped = await redeemResetCode(api, email, code);
		if (!swapped.ok) {
			setBusy(false);
			return setFailure(swapped.reason);
		}
		try {
			const found = await checkRecoveryLink(api, swapped.value);
			setBusy(false);
			if (found === "invalid") return setFailure("expired");
			setToken(swapped.value);
			setLink(found);
			setCode("");
			setStep("choices");
		} catch (error) {
			setBusy(false);
			const reason = error instanceof KeyFlowError ? error.code : "failed";
			setFailure(
				reason === "rateLimited"
					? "tooMany"
					: reason === "unavailable"
						? "network"
						: "failed",
			);
		}
	}

	function done() {
		toast.show({ message: p("recover.signInNew") });
		if (router.canGoBack()) router.back();
		else router.replace("/sign-in");
	}

	const preset: RecoveryFailureCode | null =
		link?.keys === "recovery" ? null : "unavailable";
	const protectionOn = link?.protectionOn ?? false;

	return (
		<Screen>
			{step === "email" ? (
				<View style={{ gap: space[4] }}>
					<Text tone="fg2">{t("emailBody")}</Text>
					<TextField
						autoComplete="email"
						disabled={busy}
						inputMode="email"
						invalid={failure !== null}
						keyboardType="email-address"
						label={ts("email")}
						onChangeText={(text) => {
							setEmail(text);
							setFailure(null);
						}}
						onSubmitEditing={send}
						returnKeyType="go"
						textContentType="emailAddress"
						value={email}
					/>
					<StepError text={failure ? words(failure) : null} />
					<Button
						busy={busy}
						disabled={busy || !email.includes("@")}
						label={busy ? t("sending") : t("sendCode")}
						onPress={send}
					/>
				</View>
			) : null}
			{step === "code" ? (
				<View style={{ gap: space[4] }}>
					<Text tone="fg2">{t("codeBody")}</Text>
					<TextField
						autoComplete="off"
						disabled={busy}
						invalid={failure !== null}
						label={t("code")}
						onChangeText={(text) => {
							setCode(text);
							setFailure(null);
						}}
						onSubmitEditing={redeem}
						returnKeyType="go"
						value={code}
					/>
					<StepError text={failure ? words(failure) : null} />
					<Button
						busy={busy}
						disabled={busy || code.trim() === ""}
						label={busy ? t("checking") : p("recover.continue")}
						onPress={redeem}
					/>
					<Button
						disabled={busy}
						label={tc("back")}
						onPress={() => {
							setFailure(null);
							setStep("email");
						}}
						variant="text"
					/>
				</View>
			) : null}
			{step === "choices" ? (
				<View style={{ gap: space[4] }}>
					<Text variant="section">
						{p(`recover.choose.${protectionOn ? "titleOn" : "titleOff"}`)}
					</Text>
					<Text tone="fg2">
						{p(`recover.choose.${protectionOn ? "bodyOn" : "bodyOff"}`)}
					</Text>
					<ListGroup>
						<ListRow
							end={
								<Button
									label={p("recover.choose.useKey")}
									onPress={() => setSheet(true)}
									size="small"
									variant="outlined"
								/>
							}
							title={p("methods.key")}
						/>
						<ListRow
							end={
								<Text tone="fg3" variant="small">
									{p("methods.reason")}
								</Text>
							}
							title={p("methods.device")}
						/>
						{protectionOn ? (
							<ListRow
								end={
									<TextAction
										disabled
										label={p("recover.choose.resetAccount")}
										onPress={() => undefined}
										tone="danger"
									/>
								}
								sub={p("methods.reason")}
								title={p("recover.choose.nothingWorks")}
							/>
						) : (
							<ListRow
								end={
									<TextAction
										label={p("recover.choose.reset")}
										link
										onPress={() =>
											baseUrl
												? void openWebPage(baseUrl, "/auth/forgot-password")
												: undefined
										}
										tone="danger"
									/>
								}
								sub={p("recover.choose.resetMeta")}
								title={p("recover.choose.nothingWorks")}
							/>
						)}
					</ListGroup>
				</View>
			) : null}
			{callbacks ? (
				<RecoverSheet
					begin={callbacks.begin}
					finish={callbacks.finish}
					onClose={() => setSheet(false)}
					onDone={() => {
						setSheet(false);
						done();
					}}
					preset={preset}
					visible={sheet}
				/>
			) : null}
		</Screen>
	);
}
