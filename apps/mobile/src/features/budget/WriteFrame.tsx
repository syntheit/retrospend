import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Note } from "./parts";
import type { BudgetEnvelope, BudgetMonth } from "./source";

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
 * changes, and one primary button that stays off until the dry run is in.
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
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			{children}
			{changes}
			{failed ? <Note tone="attention">{t("error")}</Note> : null}
			<Button
				disabled={!ready || busy}
				label={busy ? t("saving") : submitLabel}
				onPress={onSubmit}
			/>
		</View>
	);
}
