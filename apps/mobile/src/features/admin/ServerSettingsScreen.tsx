import type { RetrospendClient } from "@retrospend/api-client";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { Block, PageState, PickerRow, SettingsPage } from "../settings/parts";
import { importJobChoices } from "./rules";
import { SwitchItem } from "./SwitchItem";
import { detailOf, useAdminRead } from "./useAdminRead";
import { useServerSettings } from "./useServerSettings";

type AiPatch = Parameters<RetrospendClient["admin"]["updateAiSettings"]>[0];
type Privacy = "minimal" | "anonymized" | "full";

/**
 * Server settings: the feature switches, the audit log's detail, how many
 * imports run at once, and which AI the server uses. Every change saves at
 * once and says so in a toast. Sign-up and invite codes are on their own page;
 * email, token quotas and backups stay on the web.
 */
export function ServerSettingsScreen() {
	const t = useTranslations("mobile.admin.settings");
	const ta = useTranslations("mobile.admin");
	const { api } = useSession();
	const toast = useToast();
	const server = useServerSettings();
	const ai = useAdminRead((client) => client.admin.getAiSettings());

	async function saveAi(change: AiPatch) {
		if (!api) return;
		ai.patch((current) => ({ ...current, ...change }));
		try {
			const saved = await api.admin.updateAiSettings(change, {
				context: { idempotencyKey: newClientId() },
			});
			ai.patch(() => saved);
			toast.show({ message: ta("saved") });
		} catch (error) {
			toast.show({ message: detailOf(error) ?? ta("saveError") });
			await ai.reload();
		}
	}

	if (server.state.status !== "ready" || ai.state.status !== "ready") {
		return (
			<PageState
				failed={server.state.status === "error" || ai.state.status === "error"}
			/>
		);
	}
	const s = server.state.data;
	const a = ai.state.data;

	return (
		<SettingsPage>
			<Block title={t("features")}>
				<ListGroup>
					<SwitchItem
						detail={t("feedbackDetail")}
						label={t("feedback")}
						onChange={(on) => void server.save({ enableFeedback: on })}
						value={s.enableFeedback}
					/>
					<SwitchItem
						detail={t("webhooksDetail")}
						label={t("webhooks")}
						onChange={(on) =>
							void server.save({ webhooksAllowPrivateTargets: on })
						}
						value={s.webhooksAllowPrivateTargets}
					/>
				</ListGroup>
			</Block>
			<Block title={t("limits")}>
				<ListGroup>
					<PickerRow<Privacy>
						label={t("audit")}
						onChange={(value) => void server.save({ auditPrivacyMode: value })}
						options={[
							{ value: "minimal", label: t("auditMinimal") },
							{ value: "anonymized", label: t("auditAnonymized") },
							{ value: "full", label: t("auditFull") },
						]}
						sub={t(`auditDetail.${s.auditPrivacyMode}`)}
						value={s.auditPrivacyMode}
					/>
					<PickerRow
						label={t("imports")}
						onChange={(value) =>
							void server.save({ maxConcurrentImportJobs: Number(value) })
						}
						options={importJobChoices(s.maxConcurrentImportJobs).map((n) => ({
							value: String(n),
							label: String(n),
						}))}
						sub={t("importsDetail")}
						value={String(s.maxConcurrentImportJobs)}
					/>
				</ListGroup>
			</Block>
			<Block title={t("ai")}>
				<ListGroup>
					<PickerRow<"LOCAL" | "EXTERNAL">
						label={t("aiMode")}
						onChange={(value) => void saveAi({ defaultAiMode: value })}
						options={[
							{ value: "LOCAL", label: t("aiLocal") },
							{ value: "EXTERNAL", label: t("aiExternal") },
						]}
						value={a.defaultAiMode}
					/>
					<PickerRow<"WHITELIST" | "BLACKLIST">
						label={t("aiAccess")}
						onChange={(value) => void saveAi({ externalAiAccessMode: value })}
						options={[
							{ value: "WHITELIST", label: t("aiAllowList") },
							{ value: "BLACKLIST", label: t("aiBlockList") },
						]}
						sub={t(
							a.externalAiAccessMode === "WHITELIST"
								? "aiAllowListDetail"
								: "aiBlockListDetail",
						)}
						value={a.externalAiAccessMode}
					/>
					<ListRow
						end={
							<Text tone="fg2">
								{a.openRouterConfigured ? t("keySet") : t("keyNotSet")}
							</Text>
						}
						title={t("aiKey")}
					/>
				</ListGroup>
			</Block>
		</SettingsPage>
	);
}
