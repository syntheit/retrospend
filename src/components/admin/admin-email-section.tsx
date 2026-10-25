"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useToast } from "~/components/ui/toast";
import { SelectField } from "~/features/settings/select-field";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import { api } from "~/trpc/react";
import type { AdminSettings, SettingsUpdate } from "./admin-settings-sections";

type TestType =
	| "basic"
	| "password-reset"
	| "credential-change"
	| "email-verification";

/** SMTP status, the on/off switch and a test email. */
export function EmailSection({
	adminEmail,
	settings,
	isUpdating,
	onSave,
}: {
	adminEmail?: string | null;
	settings?: AdminSettings;
	isUpdating: boolean;
	onSave: (updates: SettingsUpdate, message: string) => Promise<void>;
}) {
	const t = useTranslations("admin");
	const toast = useToast();
	const [testEmail, setTestEmail] = useState(adminEmail ?? "");
	const [testType, setTestType] = useState<TestType>("basic");
	const utils = api.useUtils();
	const { data: features, isLoading } = api.auth.getAppFeatures.useQuery();
	const sendTest = api.admin.sendTestEmail.useMutation({
		onSuccess: (data) => toast.saved(data.message),
		onError: (error) => toast.failed(error.message),
	});
	const configured = features?.isSmtpConfigured ?? false;

	const handleSendTest = (e: React.FormEvent) => {
		e.preventDefault();
		if (!testEmail) {
			toast.failed(t("pleaseEnterEmail"));
			return;
		}
		sendTest.mutate({ email: testEmail, type: testType });
	};

	return (
		<div>
			<h2 className="text-fg text-section">{t("emailServer")}</h2>
			<p className="text-fg-3 text-small mb-2">{t("emailServerDescription")}</p>
			<SettingRows>
				<SettingRow label={t("emailStatus")}>
					<span className="text-fg text-body">
						{isLoading
							? t("checking")
							: configured
								? t("configuredInEnvironment")
								: t("notConfiguredCheckEnv")}
					</span>
				</SettingRow>
				<SettingRow
					label={t("enableEmailFunctionality")}
					labelFor="enable-email-switch"
					meta={t("enableEmailFunctionalityDescription")}
				>
					<Switch
						checked={settings?.enableEmail ?? true}
						disabled={isUpdating || !configured}
						id="enable-email-switch"
						onCheckedChange={async (on) => {
							await onSave(
								{ enableEmail: on },
								on
									? t("emailFunctionalityEnabled")
									: t("emailFunctionalityDisabled"),
							);
							void utils.auth.getAppFeatures.invalidate();
						}}
					/>
				</SettingRow>
				{features?.isEmailEnabled && (
					<>
						<SettingRow
							label={t("test")}
							labelFor="test-email-type"
							meta={t("testEmailDescription")}
						>
							<SelectField
								disabled={sendTest.isPending}
								id="test-email-type"
								onChange={setTestType}
								options={[
									{ value: "basic", label: t("basicTestEmail") },
									{ value: "password-reset", label: t("passwordResetSample") },
									{
										value: "credential-change",
										label: t("credentialChangeSample"),
									},
									{
										value: "email-verification",
										label: t("verificationSample"),
									},
								]}
								value={testType}
							/>
						</SettingRow>
						<li>
							<form className="flex gap-2 py-2" onSubmit={handleSendTest}>
								<Input
									aria-label={t("adminEmail")}
									className="h-ctl flex-1"
									disabled={sendTest.isPending}
									onChange={(e) => setTestEmail(e.target.value)}
									placeholder={t("adminEmail")}
									type="email"
									value={testEmail}
								/>
								<Button
									disabled={sendTest.isPending}
									kind="secondary"
									loading={sendTest.isPending}
									type="submit"
								>
									{sendTest.isPending ? t("sending") : t("test")}
								</Button>
							</form>
						</li>
					</>
				)}
			</SettingRows>
		</div>
	);
}
