"use client";

import { useTranslations } from "next-intl";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";

/** The second sign-in step with a saved backup code. */
export function BackupCodeStep({
	backupCode,
	setBackupCode,
	error,
	isLoading,
	onSubmit,
	onUseAuthenticator,
	onBack,
}: {
	backupCode: string;
	setBackupCode: (value: string) => void;
	error: string;
	isLoading: boolean;
	onSubmit: (e: React.FormEvent) => void;
	onUseAuthenticator: () => void;
	onBack: () => void;
}) {
	const t = useTranslations("auth");
	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				description={t("backupCodeDescription")}
				title={t("twoFactorAuth")}
			>
				<form className="space-y-6" onSubmit={onSubmit}>
					<div className="space-y-2">
						<Label htmlFor="backup-code">{t("backupCode")}</Label>
						<Input
							autoCapitalize="none"
							autoComplete="one-time-code"
							autoCorrect="off"
							autoFocus
							className="font-mono"
							disabled={isLoading}
							id="backup-code"
							onChange={(e) => setBackupCode(e.target.value)}
							placeholder={t("enterBackupCode")}
							spellCheck={false}
							value={backupCode}
						/>
					</div>

					{error && <div className="text-destructive text-sm">{error}</div>}

					<Button
						className="w-full"
						disabled={isLoading || !backupCode.trim()}
						type="submit"
					>
						{isLoading ? t("verifying") : t("verifyCode")}
					</Button>

					<div className="flex flex-col items-center gap-2 text-sm">
						<Button
							className="text-muted-foreground h-auto p-0 hover:underline"
							onClick={onUseAuthenticator}
							type="button"
							variant="link"
						>
							{t("useAuthenticatorCode")}
						</Button>
						<Button
							className="text-muted-foreground h-auto p-0 hover:underline"
							onClick={onBack}
							type="button"
							variant="link"
						>
							{t("backToLogin")}
						</Button>
					</div>
				</form>
			</AuthPanel>
		</div>
	);
}

/** The second sign-in step with a code from the authenticator app. */
export function AuthenticatorStep({
	totpCode,
	setTotpCode,
	error,
	isLoading,
	onSubmit,
	onComplete,
	onUseBackupCode,
	onBack,
}: {
	totpCode: string;
	setTotpCode: (value: string) => void;
	error: string;
	isLoading: boolean;
	onSubmit: (e: React.FormEvent) => void;
	onComplete: (code: string) => void;
	onUseBackupCode: () => void;
	onBack: () => void;
}) {
	const t = useTranslations("auth");
	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				description={t("twoFactorDescription")}
				title={t("twoFactorAuth")}
			>
				<form
					className="flex flex-col items-center space-y-6"
					onSubmit={onSubmit}
				>
					<div className="space-y-2">
						<InputOTP
							maxLength={6}
							onChange={setTotpCode}
							onComplete={onComplete}
							value={totpCode}
						>
							<InputOTPGroup>
								<InputOTPSlot index={0} />
								<InputOTPSlot index={1} />
								<InputOTPSlot index={2} />
								<InputOTPSlot index={3} />
								<InputOTPSlot index={4} />
								<InputOTPSlot index={5} />
							</InputOTPGroup>
						</InputOTP>
					</div>

					{error && <div className="text-destructive text-sm">{error}</div>}

					<Button
						className="w-full"
						disabled={isLoading || totpCode.length !== 6}
						type="submit"
					>
						{isLoading ? t("verifying") : t("verifyCode")}
					</Button>

					<div className="mt-4 flex flex-col items-center gap-2 text-sm">
						<Button
							className="text-muted-foreground h-auto p-0 hover:underline"
							onClick={onUseBackupCode}
							type="button"
							variant="link"
						>
							{t("useBackupCode")}
						</Button>
						<Button
							className="text-muted-foreground h-auto p-0 hover:underline"
							onClick={onBack}
							type="button"
							variant="link"
						>
							{t("backToLogin")}
						</Button>
					</div>
				</form>
			</AuthPanel>
		</div>
	);
}
