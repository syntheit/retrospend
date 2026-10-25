"use client";

import { useTranslations } from "next-intl";
import { Switch } from "~/components/ui/switch";
import { SelectField } from "~/features/settings/select-field";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { NumberField } from "./admin-number-field";

export type SettingsUpdate = RouterInputs["admin"]["updateSettings"];
export type AdminSettings = RouterOutputs["admin"]["getSettings"];
export type AiUpdate = RouterInputs["admin"]["updateAiSettings"];
export type AiSettings = RouterOutputs["admin"]["getAiSettings"];

type Save = (updates: SettingsUpdate, message: string) => Promise<void>;

function Heading({ title, hint }: { title: string; hint: string }) {
	return (
		<>
			<h2 className="text-fg text-section">{title}</h2>
			<p className="text-fg-3 text-small mb-2">{hint}</p>
		</>
	);
}

/** Who may sign up: invite codes, who can make them, and feedback. */
export function RegistrationSection({
	settings,
	isUpdating,
	onSave,
}: {
	settings?: AdminSettings;
	isUpdating: boolean;
	onSave: Save;
}) {
	const t = useTranslations("admin");
	const inviteOnly = settings?.inviteOnlyEnabled ?? false;
	return (
		<div>
			<Heading
				hint={t("registrationSettingsDescription")}
				title={t("registrationSettings")}
			/>
			<SettingRows>
				<SettingRow
					label={t("requireInviteCodes")}
					labelFor="invite-codes-switch"
					meta={t("requireInviteCodesDescription")}
				>
					<Switch
						checked={inviteOnly}
						disabled={isUpdating}
						id="invite-codes-switch"
						onCheckedChange={(on) =>
							onSave(
								{ inviteOnlyEnabled: on },
								on ? t("inviteOnlyEnabled") : t("inviteOnlyDisabled"),
							)
						}
					/>
				</SettingRow>
				<SettingRow
					label={t("allowUserInvites")}
					labelFor="user-invite-codes-switch"
					meta={t("allowUserInvitesDescription")}
				>
					<Switch
						checked={settings?.allowAllUsersToGenerateInvites ?? false}
						disabled={isUpdating || !inviteOnly}
						id="user-invite-codes-switch"
						onCheckedChange={(on) =>
							onSave(
								{ allowAllUsersToGenerateInvites: on },
								on ? t("userInvitesEnabled") : t("userInvitesDisabled"),
							)
						}
					/>
				</SettingRow>
				<SettingRow
					label={t("enableFeedback")}
					labelFor="enable-feedback-switch"
					meta={t("enableFeedbackDescription")}
				>
					<Switch
						checked={settings?.enableFeedback ?? false}
						disabled={isUpdating}
						id="enable-feedback-switch"
						onCheckedChange={(on) =>
							onSave(
								{ enableFeedback: on },
								on ? t("feedbackEnabledToast") : t("feedbackDisabledToast"),
							)
						}
					/>
				</SettingRow>
			</SettingRows>
		</div>
	);
}

/** Import concurrency and audit log privacy. */
export function SystemSection({
	settings,
	isUpdating,
	onSave,
}: {
	settings?: AdminSettings;
	isUpdating: boolean;
	onSave: Save;
}) {
	const t = useTranslations("admin");
	const mode = settings?.auditPrivacyMode ?? "MINIMAL";
	return (
		<div>
			<Heading hint={t("systemDescription")} title={t("system")} />
			<SettingRows>
				<SettingRow
					label={t("auditLogPrivacyMode")}
					labelFor="audit-privacy-mode"
					meta={
						mode === "MINIMAL"
							? t("auditMinimalDescription")
							: mode === "ANONYMIZED"
								? t("auditAnonymizedDescription")
								: t("auditFullDescription")
					}
				>
					<SelectField
						disabled={isUpdating}
						id="audit-privacy-mode"
						onChange={(v) =>
							onSave({ auditPrivacyMode: v }, t("settingsUpdated"))
						}
						options={[
							{ value: "MINIMAL", label: t("auditMinimal") },
							{ value: "ANONYMIZED", label: t("auditAnonymized") },
							{ value: "FULL", label: t("auditFull") },
						]}
						value={mode}
					/>
				</SettingRow>
				<SettingRow
					label={t("maxConcurrentImportJobs")}
					labelFor="max-concurrent-import-jobs"
					meta={t("maxConcurrentImportJobsDescription")}
				>
					<NumberField
						disabled={isUpdating}
						id="max-concurrent-import-jobs"
						label={t("maxConcurrentImportJobs")}
						max={50}
						min={1}
						onSave={(n) =>
							onSave({ maxConcurrentImportJobs: n }, t("settingsUpdated"))
						}
						value={settings?.maxConcurrentImportJobs}
					/>
				</SettingRow>
			</SettingRows>
		</div>
	);
}

/** AI providers for bank statement imports: mode, access control and quotas. */
export function AiSettingsSection({
	aiSettings,
	isUpdating,
	onUpdate,
}: {
	aiSettings?: AiSettings;
	isUpdating: boolean;
	onUpdate: (updates: AiUpdate) => Promise<void>;
}) {
	const t = useTranslations("admin");
	const access = aiSettings?.externalAiAccessMode ?? "WHITELIST";
	return (
		<div>
			<Heading hint={t("aiProcessingDescription")} title={t("aiProcessing")} />
			<SettingRows>
				<SettingRow label={t("openRouter")}>
					<span className="text-fg text-body">
						{aiSettings?.openRouterConfigured
							? t("apiKeyConfigured")
							: t("notConfigured")}
					</span>
				</SettingRow>
				<SettingRow label={t("defaultAiMode")} labelFor="default-ai-mode">
					<SelectField
						disabled={isUpdating}
						id="default-ai-mode"
						onChange={(v) => void onUpdate({ defaultAiMode: v })}
						options={[
							{ value: "LOCAL", label: t("localOllama") },
							{ value: "EXTERNAL", label: t("externalOpenRouter") },
						]}
						value={aiSettings?.defaultAiMode ?? "LOCAL"}
					/>
				</SettingRow>
				<SettingRow
					label={t("accessControlMode")}
					labelFor="ai-access-mode"
					meta={
						access === "WHITELIST"
							? t("whitelistDescription")
							: t("blacklistDescription")
					}
				>
					<SelectField
						disabled={isUpdating}
						id="ai-access-mode"
						onChange={(v) => void onUpdate({ externalAiAccessMode: v })}
						options={[
							{ value: "WHITELIST", label: t("whitelistDenyByDefault") },
							{ value: "BLACKLIST", label: t("blacklistAllowByDefault") },
						]}
						value={access}
					/>
				</SettingRow>
				<SettingRow
					label={t("monthlyLocalTokenQuota")}
					labelFor="ai-local-token-quota"
					meta={t("tokensOllama")}
				>
					<NumberField
						disabled={isUpdating}
						id="ai-local-token-quota"
						label={t("monthlyLocalTokenQuota")}
						min={0}
						onSave={(n) => void onUpdate({ monthlyLocalAiTokenQuota: n })}
						value={aiSettings?.monthlyLocalAiTokenQuota}
					/>
				</SettingRow>
				<SettingRow
					label={t("monthlyExternalTokenQuota")}
					labelFor="ai-external-token-quota"
					meta={t("tokensOpenRouter")}
				>
					<NumberField
						disabled={isUpdating}
						id="ai-external-token-quota"
						label={t("monthlyExternalTokenQuota")}
						min={0}
						onSave={(n) => void onUpdate({ monthlyExternalAiTokenQuota: n })}
						value={aiSettings?.monthlyExternalAiTokenQuota}
					/>
				</SettingRow>
			</SettingRows>
		</div>
	);
}
