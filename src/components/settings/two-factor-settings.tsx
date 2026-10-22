"use client";

import {
	AlertCircle,
	CheckCircle,
	Copy,
	Download,
	KeyRound,
	Shield,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { useSession } from "~/hooks/use-session";
import { authClient } from "~/lib/auth-client";

export function TwoFactorSettings() {
	const t = useTranslations("settingsPage");
	const { data: session, refetch } = useSession();
	const [status, setStatus] = useState<
		"idle" | "generating" | "setup" | "backupCodes" | "disabling"
	>("idle");
	const [totpUri, setTotpUri] = useState("");
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [isVerifying, setIsVerifying] = useState(false);
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [backupCodesSaved, setBackupCodesSaved] = useState(false);

	const is2FAEnabled = session?.user.twoFactorEnabled;

	const backupCodesText = () =>
		`${t("backupCodesFileHeader")}\n\n${backupCodes.join("\n")}\n`;

	const handleCopyBackupCodes = async () => {
		try {
			await navigator.clipboard.writeText(backupCodes.join("\n"));
			toast.success(t("backupCodesCopied"));
		} catch {
			toast.error(t("backupCodesCopyFailed"));
		}
	};

	const handleDownloadBackupCodes = () => {
		const blob = new Blob([backupCodesText()], {
			type: "text/plain;charset=utf-8;",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "retrospend-backup-codes.txt";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleFinishBackupCodes = () => {
		// The codes are shown once; drop them from memory when done
		setBackupCodes([]);
		setBackupCodesSaved(false);
		setStatus("idle");
		refetch();
	};

	const handleEnableInit = async () => {
		setStatus("generating");
		setError("");
		try {
			const { data, error } = await authClient.twoFactor.enable({
				password: password,
			});
			if (error) {
				toast.error(error.message || t("error"));
				setStatus("idle");
				return;
			}
			setTotpUri(data?.method === "totp" ? data.totpURI : "");
			setBackupCodes(data?.method === "totp" ? data.backupCodes : []);
			setStatus("setup");
			setPassword("");
		} catch {
			setStatus("idle");
			toast.error(t("anErrorOccurred"));
		}
	};

	const handleVerifySetup = async (codeToVerify?: string) => {
		if (isVerifying) return;
		const currentCode = codeToVerify || code;
		if (currentCode.length !== 6) return;
		
		setIsVerifying(true);
		try {
			// enable() created the secret and backup codes; verifying a TOTP code
			// from the app is what turns 2FA on.
			const { error } = await authClient.twoFactor.verifyTotp({
				code: currentCode,
			});
			if (error) {
				setError(error.message || t("failedToVerify"));
				return;
			}

			toast.success(t("twoFactorEnabled"));
			setPassword("");
			setCode("");
			setError("");
			// Show the backup codes once before finishing. The session is
			// refetched when the user confirms they saved them.
			if (backupCodes.length > 0) {
				setStatus("backupCodes");
			} else {
				handleFinishBackupCodes();
			}
		} catch {
			setError(t("failedToVerifyCode"));
		} finally {
			setIsVerifying(false);
		}
	};

	const handleDisable = async () => {
		if (!password) {
			setError(t("passwordRequiredToDisable2FA"));
			return;
		}

		setStatus("disabling");
		try {
			const { error } = await authClient.twoFactor.disable({ password });
			if (error) {
				setError(error.message || t("failedToDisable2FA"));
			} else {
				toast.success(t("twoFactorDisabled"));
				setPassword("");
				refetch();
			}
		} catch {
			setError(t("failedToDisable2FA"));
		} finally {
			setStatus("idle");
		}
	};

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Shield className="h-5 w-5 text-primary" />
					{t("twoFactorAuth")}
				</CardTitle>
				<CardDescription>
					{t("twoFactorAuthDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{status === "backupCodes" ? (
					<div className="space-y-6">
						<div className="space-y-1">
							<h4 className="flex items-center gap-2 font-medium text-sm">
								<KeyRound className="h-4 w-4 text-primary" />
								{t("backupCodesTitle")}
							</h4>
							<p className="max-w-md text-muted-foreground text-sm">
								{t("backupCodesDescription")}
							</p>
						</div>

						<ul className="grid w-fit grid-cols-2 gap-x-8 gap-y-2 rounded-xl border bg-secondary/20 p-4 font-mono text-sm">
							{backupCodes.map((backupCode) => (
								<li className="tabular-nums" key={backupCode}>
									{backupCode}
								</li>
							))}
						</ul>

						<div className="flex flex-wrap gap-3">
							<Button
								onClick={handleCopyBackupCodes}
								size="sm"
								type="button"
								variant="outline"
							>
								<Copy className="mr-2 h-4 w-4" />
								{t("copyBackupCodes")}
							</Button>
							<Button
								onClick={handleDownloadBackupCodes}
								size="sm"
								type="button"
								variant="outline"
							>
								<Download className="mr-2 h-4 w-4" />
								{t("downloadBackupCodes")}
							</Button>
						</div>

						<div className="flex items-center gap-2">
							<Checkbox
								checked={backupCodesSaved}
								id="backup-codes-saved"
								onCheckedChange={(checked) => setBackupCodesSaved(checked === true)}
							/>
							<Label className="font-normal text-sm" htmlFor="backup-codes-saved">
								{t("backupCodesSaved")}
							</Label>
						</div>

						<div className="flex justify-end">
							<Button
								disabled={!backupCodesSaved}
								onClick={handleFinishBackupCodes}
								size="sm"
								type="button"
							>
								{t("done")}
							</Button>
						</div>
					</div>
				) : is2FAEnabled ? (
					<div className="space-y-6">
						<div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
							<CheckCircle className="h-5 w-5" />
							<span className="font-medium">{t("twoFactorCurrentlyEnabled")}</span>
						</div>

						<div className="space-y-4 border-t pt-6">
							<div className="space-y-1">
								<h4 className="font-medium text-sm">{t("disable2FA")}</h4>
								<p className="text-muted-foreground text-sm">
									{t("disable2FADescription")}
								</p>
							</div>
							<form
								className="flex max-w-md gap-3"
								onSubmit={(e) => {
									e.preventDefault();
									handleDisable();
								}}
							>
								<Input
									className="border-transparent bg-secondary/20 transition-all hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20"
									onChange={(e) => setPassword(e.target.value)}
									placeholder={t("password")}
									type="password"
									value={password}
								/>
								<Button
									disabled={status === "disabling" || !password}
									type="submit"
									variant="destructive"
								>
									{status === "disabling" ? t("disabling") : t("disable2FA")}
								</Button>
							</form>
							{error && <p className="text-destructive text-sm">{error}</p>}
						</div>
					</div>
				) : (
					<div className="space-y-6">
						{(status === "idle" || status === "generating") && (
							<div className="space-y-4">
								<p className="text-muted-foreground text-sm">
									{t("twoFactorExplanation")}
								</p>
								<div className="max-w-md space-y-2">
									<Label
										className="font-medium text-muted-foreground text-sm"
										htmlFor="password-2fa"
									>
										{t("verifyPasswordToEnable")}
									</Label>
									<Input
										className="border-transparent bg-secondary/20 transition-all hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20"
										id="password-2fa"
										onChange={(e) => setPassword(e.target.value)}
										placeholder={t("yourCurrentPassword")}
										type="password"
										value={password}
									/>
								</div>
								{status === "generating" && (
									<p className="animate-pulse text-primary text-sm">
										{t("initiatingSetup")}
									</p>
								)}
								<div className="mt-4 flex justify-end">
									<Button
										disabled={!password || status === "generating"}
										onClick={handleEnableInit}
										size="sm"
										type="button"
									>
										{t("enableTwoFactorAuth")}
									</Button>
								</div>
							</div>
						)}

						{status === "setup" && (
							<form
								className="space-y-8"
								id="2fa-verify-form"
								onSubmit={(e) => {
									e.preventDefault();
									handleVerifySetup();
								}}
							>
								<div className="space-y-4">
									<div className="flex w-fit flex-col items-center justify-center rounded-xl border bg-white p-6 shadow-sm">
										<QRCodeSVG size={180} value={totpUri} />
									</div>
									<p className="max-w-sm text-muted-foreground text-sm">
										{t("scanQRCode")}
									</p>
								</div>

								<div className="space-y-4">
									<Label className="font-medium text-sm">
										{t("enterVerificationCode")}
									</Label>
									<InputOTP 
										maxLength={6} 
										onChange={setCode} 
										value={code}
										onComplete={(c) => handleVerifySetup(c)}
										disabled={isVerifying}
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

								{error && (
									<div className="flex items-center gap-2 text-destructive text-sm">
										<AlertCircle className="h-4 w-4" />
										<span>{error}</span>
									</div>
								)}

								<div className="mt-6 flex justify-end gap-3">
									<Button
										onClick={() => {
											setBackupCodes([]);
											setStatus("idle");
										}}
										size="sm"
										type="button"
										variant="ghost"
									>
										{t("cancel")}
									</Button>
									<Button disabled={code.length !== 6 || isVerifying} size="sm" type="submit">
										{isVerifying ? t("verifying") : t("verifyAndEnable")}
									</Button>
								</div>
							</form>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
