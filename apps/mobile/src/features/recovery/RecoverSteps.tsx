import {
	cleanGroup,
	GROUP_COUNT,
	GROUP_LENGTH,
	type RecoverAction,
	type RecoverState,
} from "@retrospend/crypto/client";
import { useRef } from "react";
import { type TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { PasswordStep, StepError } from "../settings/protection/EnableSteps";

/** Groups per row: nine in three rows of three, as the key is shown. */
const COLUMNS = 3;
const INDEXES = Array.from({ length: GROUP_COUNT }, (_, i) => i);
const ROWS = Array.from({ length: GROUP_COUNT / COLUMNS }, (_, r) =>
	INDEXES.slice(r * COLUMNS, (r + 1) * COLUMNS),
);

/**
 * Whether a change to a group's text is a paste or an autofill rather than a
 * key press: it adds more than one character at once, or carries the hyphens
 * or spaces of a whole key. A field must not cap its length for this to work
 * (the system cuts a paste to the cap), so the reducer's `cleanGroup` does.
 */
export function isPaste(was: string, now: string): boolean {
	return now.length - was.length > 1 || /[\s-]/.test(now);
}

/** R3: the key in nine fields, or pasted whole into any of them. */
export function EnterKeyStep({
	state,
	dispatch,
	locked,
	error,
}: {
	state: RecoverState;
	dispatch: (action: RecoverAction) => void;
	locked: boolean;
	error: string | null;
}) {
	const t = useTranslations("protection.recover");
	const group = useTranslations("protection.recoveryKey");
	const { space } = useTheme();
	const inputs = useRef<(TextInput | null)[]>([]);
	return (
		<View style={{ gap: space[4] }}>
			<Text tone="fg2">{t("enterBody")}</Text>
			<View style={{ gap: space[2] }}>
				{ROWS.map((row) => (
					<View key={row[0]} style={{ flexDirection: "row", gap: space[2] }}>
						{row.map((index) => (
							<View key={index} style={{ flex: 1 }}>
								<TextField
									autoComplete="off"
									disabled={locked}
									hideLabel
									inputRef={(node) => {
										inputs.current[index] = node;
									}}
									label={group("group", { number: index + 1 })}
									onChangeText={(text) => {
										const was = state.groups[index] ?? "";
										if (isPaste(was, text))
											return dispatch({ type: "paste", from: index, text });
										dispatch({ type: "group", index, value: text });
										// A full group moves on to the next one.
										if (
											cleanGroup(text).length >= GROUP_LENGTH &&
											index < GROUP_COUNT - 1
										)
											inputs.current[index + 1]?.focus();
									}}
									placeholder={group("group", { number: index + 1 })}
									value={state.groups[index] ?? ""}
								/>
							</View>
						))}
					</View>
				))}
			</View>
			<StepError text={error} />
		</View>
	);
}

/** R4: the new password, twice, with the rules. Only this phone ever sees it. */
export function NewPasswordStep({
	state,
	dispatch,
	locked,
	error,
}: {
	state: RecoverState;
	dispatch: (action: RecoverAction) => void;
	locked: boolean;
	error: string | null;
}) {
	const t = useTranslations("protection.recover");
	return (
		<PasswordStep
			body={t("newPasswordBody")}
			confirm={state.confirm}
			disabled={locked}
			error={error}
			next={state.password}
			onConfirm={(value) => dispatch({ type: "text", field: "confirm", value })}
			onNext={(value) => dispatch({ type: "text", field: "password", value })}
		/>
	);
}
