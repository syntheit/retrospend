import { passwordMeetsRules } from "@retrospend/api-contract";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { ChangeList } from "@/ui/ChangeList";
import { Glyph } from "@/ui/Glyph";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { FieldError, TextField } from "@/ui/TextField";
import { PasswordRules } from "../security/PasswordRules";

/** Shown under a step's fields when something went wrong; read out at once. */
export function StepError({ text }: { text: string | null }) {
	return text ? (
		<Text accessibilityRole="alert" tone="danger">
			{text}
		</Text>
	) : null;
}

/** E1: what turning protection on changes and what it leaves alone. */
export function WhatStep({ onSeeWhich }: { onSeeWhich?: () => void }) {
	const t = useTranslations("protection.enable.what");
	const { space } = useTheme();
	const line = (key: string, text: string) => ({
		key,
		label: text,
		value: "",
	});
	return (
		<View style={{ gap: space[3] }}>
			<ChangeList
				changes={[
					line("sealed", t("body")),
					line("shared", t("shared")),
					line("backups", t("backups")),
					line("features", t("features")),
				]}
				holds={[line("unchanged", t("unchanged"))]}
				status="ready"
			/>
			{onSeeWhich ? (
				<View style={{ alignItems: "flex-start" }}>
					<TextAction label={t("seeWhich")} onPress={onSeeWhich} />
				</View>
			) : null}
		</View>
	);
}

/** Whether E2 can continue: the new password meets the rules and is typed twice alike. */
export function passwordStepReady(next: string, confirm: string): boolean {
	return passwordMeetsRules(next) && next === confirm;
}

/** E2: the new password, with its rules, typed twice. */
export function PasswordStep({
	next,
	confirm,
	onNext,
	onConfirm,
	disabled,
	error,
}: {
	next: string;
	confirm: string;
	onNext: (value: string) => void;
	onConfirm: (value: string) => void;
	disabled: boolean;
	error: string | null;
}) {
	const t = useTranslations("protection.enable.newPassword");
	const tp = useTranslations("mobile.settings.security.password");
	const { space } = useTheme();
	const differs = confirm !== "" && confirm !== next;
	return (
		<View style={{ gap: space[4] }}>
			<Text tone="fg2">{t("body")}</Text>
			<TextField
				autoComplete="new-password"
				disabled={disabled}
				label={tp("new")}
				onChangeText={onNext}
				secure
				value={next}
			/>
			<PasswordRules value={next} />
			<TextField
				autoComplete="new-password"
				disabled={disabled}
				invalid={differs}
				label={tp("confirm")}
				onChangeText={onConfirm}
				secure
				value={confirm}
			/>
			{differs ? <FieldError>{tp("mismatch")}</FieldError> : null}
			<StepError text={error} />
		</View>
	);
}

/**
 * E3: the ways back in. The recovery key is the one that exists now; the
 * other two say why they are not there yet (their reason, no action).
 */
export function MethodsStep({
	keyDone,
	onCreateKey,
}: {
	keyDone: boolean;
	onCreateKey: () => void;
}) {
	const t = useTranslations("protection.methods");
	const { color, space, size } = useTheme();
	const later = (key: "device" | "person") => (
		<ListRow
			end={
				<Text tone="fg3" variant="small">
					{t("reason")}
				</Text>
			}
			sub={t(`${key}Body`)}
			title={t(key)}
		/>
	);
	return (
		<View style={{ gap: space[3] }}>
			<ListGroup>
				<ListRow
					end={
						keyDone ? (
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: space[1],
								}}
							>
								<Glyph
									color={color.positive}
									name="CircleCheck"
									size={size.icon.phone}
								/>
								<Text tone="positive">{t("done")}</Text>
							</View>
						) : (
							<Button
								label={t("createKey")}
								onPress={onCreateKey}
								size="small"
								variant="filled"
							/>
						)
					}
					sub={t("keyBody")}
					title={t("key")}
				/>
				{later("device")}
				{later("person")}
			</ListGroup>
		</View>
	);
}

/** The last step's fields: the current password, and the code when two-factor is on. */
export function ConfirmYouStep({
	password,
	code,
	twoFactor,
	onPassword,
	onCode,
	disabled,
	error,
}: {
	password: string;
	code: string;
	twoFactor: boolean;
	onPassword: (value: string) => void;
	onCode: (value: string) => void;
	disabled: boolean;
	error: string | null;
}) {
	const t = useTranslations("protection.enable.confirmYou");
	const ts = useTranslations("mobile.signIn");
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			<Text tone="fg2">{t("body")}</Text>
			<TextField
				autoComplete="current-password"
				disabled={disabled}
				label={ts("password")}
				onChangeText={onPassword}
				secure
				value={password}
			/>
			{twoFactor ? (
				<TextField
					autoComplete="one-time-code"
					disabled={disabled}
					inputMode="numeric"
					label={ts("code")}
					onChangeText={onCode}
					value={code}
				/>
			) : null}
			<StepError text={error} />
		</View>
	);
}

/** The end of the sheet: the notice that says the keys are made and nothing is sealed yet. */
export function DoneStep() {
	const t = useTranslations("protection.enable");
	return <Text tone="fg2">{t("notice")}</Text>;
}
