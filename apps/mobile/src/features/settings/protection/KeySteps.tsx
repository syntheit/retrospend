import { groupMatches, recoveryKeyGroups } from "@retrospend/crypto/client";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { FieldError, TextField } from "@/ui/TextField";
import { StepError } from "./EnableSteps";
import { RecoveryKeyGrid } from "./RecoveryKeyGrid";

/** R1: the key to write down, with Copy and the platform's way to save a file. */
export function SaveKeyStep({
	keyText,
	onCopy,
	onSave,
	error,
}: {
	keyText: string;
	onCopy: () => void;
	onSave: () => void;
	error: string | null;
}) {
	const t = useTranslations("protection.recoveryKey");
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			<Text tone="fg2">{t("saveBody")}</Text>
			<RecoveryKeyGrid keyText={keyText} />
			<View style={{ flexDirection: "row", gap: space[2] }}>
				<Button
					label={t("copy")}
					onPress={onCopy}
					size="small"
					variant="outlined"
				/>
				<Button
					label={t(Platform.OS === "ios" ? "saveFiles" : "saveDevice")}
					onPress={onSave}
					size="small"
					variant="outlined"
				/>
			</View>
			<StepError text={error} />
		</View>
	);
}

/** The two groups R2 asks for, as the numbers the person sees (counted from 1). */
export function confirmNumbers(groups: readonly [number, number]) {
	return { first: groups[0] + 1, second: groups[1] + 1 };
}

/** Whether both typed groups are the key's groups, read the way the key is. */
export function confirmMatches(
	keyText: string,
	groups: readonly [number, number],
	typed: readonly [string, string],
): [boolean, boolean] {
	const all = recoveryKeyGroups(keyText);
	return [
		groupMatches(typed[0], all[groups[0]] ?? ""),
		groupMatches(typed[1], all[groups[1]] ?? ""),
	];
}

/** R2: retype two groups to prove the key was written down. */
export function ConfirmKeyStep({
	groups,
	typed,
	onType,
	wrong,
}: {
	groups: readonly [number, number];
	typed: readonly [string, string];
	onType: (index: 0 | 1, value: string) => void;
	/** Which fields the last try found wrong. */
	wrong: readonly [boolean, boolean];
}) {
	const t = useTranslations("protection.recoveryKey");
	const { space } = useTheme();
	const numbers = confirmNumbers(groups);
	const field = (index: 0 | 1, number: number) => (
		<View key={number} style={{ gap: space[1] }}>
			<TextField
				autoCapitalize="none"
				invalid={wrong[index]}
				label={t("group", { number })}
				maxLength={12}
				onChangeText={(value) => onType(index, value)}
				value={typed[index]}
			/>
			{wrong[index] ? <FieldError>{t("mismatch")}</FieldError> : null}
		</View>
	);
	return (
		<View style={{ gap: space[4] }}>
			<Text tone="fg2">{t("confirmBody", numbers)}</Text>
			{field(0, numbers.first)}
			{field(1, numbers.second)}
		</View>
	);
}
