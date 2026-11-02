import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import type { BudgetEnvelope, BudgetMonth } from "@/features/budget/source";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { usePinnedAction } from "@/ui/sheetContext";
import { Note } from "./parts";

/** What every envelope form is given. */
export interface FormProps {
	data: BudgetMonth;
	envelope: BudgetEnvelope;
	month: number;
	/** The write went through (or was undone): the screen behind refreshes. */
	onDone: () => void;
	onClose: () => void;
}

/** The signed-in client; a form only builds a body once there is one. */
export function useApi() {
	const { api } = useSession();
	return api;
}

export function noSession(): never {
	throw new Error("Signed out");
}

/**
 * The frame of a money form: the fields, what the server says the write
 * changes, and one primary button that stays off until the dry run is in. In
 * a sheet the button is the pinned footer's (usePinnedAction).
 * The frame sets the field gap once: 16 between fields. Inside a field (an
 * input and its error line) the gap is 4, set by the field itself.
 */
export function WriteFrame({
	children,
	changes,
	submitLabel,
	ready,
	busy,
	failed,
	onSubmit,
}: {
	children: ReactNode;
	changes: ReactNode;
	submitLabel: string;
	ready: boolean;
	busy: boolean;
	failed: boolean;
	onSubmit: () => void;
}) {
	const t = useTranslations("mobile.budget.write");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const label = busy ? tc("saving") : submitLabel;
	// In a sheet, Save sits in the pinned footer under the scrolling body; the
	// sheet draws it, so this frame leaves its own out.
	const pinned = usePinnedAction({
		label,
		busy,
		disabled: !ready || busy,
		onPress: onSubmit,
	});
	return (
		<View style={{ gap: space[4] }}>
			{children}
			{changes}
			{failed ? <Note tone="attention">{t("error")}</Note> : null}
			{pinned ? null : (
				<Button
					busy={busy}
					disabled={!ready || busy}
					label={label}
					onPress={onSubmit}
				/>
			)}
		</View>
	);
}
