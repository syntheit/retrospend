import { useTranslations } from "use-intl";
import { Button } from "@/ui/Button";
import type { EnableStep } from "./types";

/**
 * The sheet's pinned footer for each step: the way back or out on the left,
 * the one primary action on the right. A final refusal leaves only Close. The
 * primary waits for `ready` and shows its working label while `busy`.
 */
export function EnableFooter({
	step,
	final,
	busy,
	ready,
	go,
	onClose,
	onBackToPassword,
	onMakeKeys,
	onConfirmGroups,
	onCheckGroups,
	onSubmit,
	onFinish,
}: {
	step: EnableStep;
	final: boolean;
	busy: boolean;
	ready: boolean;
	go: (to: EnableStep) => void;
	onClose: () => void;
	onBackToPassword: () => void;
	onMakeKeys: () => void;
	onConfirmGroups: () => void;
	onCheckGroups: () => void;
	onSubmit: () => void;
	onFinish: () => void;
}) {
	const t = useTranslations("protection");
	const tc = useTranslations("mobile.common");
	const primary = (label: string, onPress: () => void, working?: string) => (
		<Button
			busy={busy}
			disabled={busy || !ready}
			label={busy && working ? working : label}
			onPress={onPress}
			variant="filled"
		/>
	);
	const secondary = (label: string, onPress: () => void) => (
		<Button disabled={busy} label={label} onPress={onPress} variant="text" />
	);

	if (final) return secondary(tc("close"), onClose);
	switch (step) {
		case "what":
			return (
				<>
					{secondary(tc("cancel"), onClose)}
					{primary(t("enable.what.continue"), () => go("password"))}
				</>
			);
		case "password":
			return (
				<>
					{secondary(t("enable.back"), () => go("what"))}
					{primary(
						t("enable.newPassword.continue"),
						onMakeKeys,
						t("enable.making"),
					)}
				</>
			);
		case "methods":
			return (
				<>
					{secondary(t("enable.back"), onBackToPassword)}
					{primary(t("enable.methods.continue"), () => go("confirmYou"))}
				</>
			);
		case "saveKey":
			return (
				<>
					{secondary(t("enable.back"), () => go("methods"))}
					{primary(t("recoveryKey.saved"), onConfirmGroups)}
				</>
			);
		case "confirmKey":
			return (
				<>
					{secondary(t("enable.back"), () => go("saveKey"))}
					{primary(t("enable.methods.continue"), onCheckGroups)}
				</>
			);
		case "confirmYou":
			return (
				<>
					{secondary(t("enable.back"), () => go("methods"))}
					{primary(t("enable.confirmYou.continue"), onSubmit, tc("saving"))}
				</>
			);
		case "done":
			return primary(tc("done"), onFinish);
	}
}
