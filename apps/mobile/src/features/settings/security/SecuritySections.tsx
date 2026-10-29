import { router } from "expo-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { FormActionRow, FormSection, FormValueRow } from "@/ui/Form";
import { useToast } from "@/ui/Toast";
import { openWebPage } from "../webPages";
import { PasswordSheet } from "./PasswordSheet";
import { type DataKind, useDataExport } from "./useDataExport";

/** The web page two-factor is managed on. */
export const TWO_FACTOR_PAGE = "/settings#security";

const DATA_KINDS: DataKind[] = ["data", "expenses", "wealth"];

/**
 * Security and Data for the Settings form, with the password sheet.
 * - Password: changed here (the server asks for the current one).
 * - Two-factor: its status here; turning it on or off and backup codes stay
 *   on the web, where better-auth runs them (a phone token cannot, by design).
 * - Signed-in devices: a list with sign out.
 * - Data: each export lands in the share sheet.
 */
export function useSecuritySections() {
	const t = useTranslations("mobile.settings.security");
	const td = useTranslations("mobile.settings.data");
	const { state } = useSession();
	const { connection } = useServerConnection();
	const toast = useToast();
	const exporter = useDataExport();
	const [changing, setChanging] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;

	async function runExport(kind: DataKind) {
		const ok = await exporter.run(kind);
		if (!ok) toast.show({ message: td("failed") });
	}

	const sections = (
		<>
			<FormSection footer={t("footer")} title={t("title")}>
				<FormActionRow
					label={t("changePassword")}
					onPress={() => setChanging(true)}
				/>
				{me ? (
					<FormValueRow
						label={t("twoFactor")}
						value={me.twoFactorEnabled ? t("on") : t("off")}
					/>
				) : null}
				{connection.status === "connected" ? (
					<FormActionRow
						label={t("twoFactorWeb")}
						onPress={() =>
							void openWebPage(connection.baseUrl, TWO_FACTOR_PAGE)
						}
					/>
				) : null}
				<FormValueRow
					label={t("devices")}
					onPress={() => router.push("/settings/sessions")}
					value={t("show")}
				/>
			</FormSection>
			<FormSection footer={td("footer")} title={td("title")}>
				{DATA_KINDS.map((kind) => (
					<FormValueRow
						key={kind}
						label={td(`kinds.${kind}`)}
						onPress={exporter.busy ? undefined : () => void runExport(kind)}
						value={
							exporter.busy === kind ? td("preparing") : td(`formats.${kind}`)
						}
					/>
				))}
			</FormSection>
		</>
	);
	const sheets = (
		<PasswordSheet onClose={() => setChanging(false)} visible={changing} />
	);
	return { sections, sheets };
}
