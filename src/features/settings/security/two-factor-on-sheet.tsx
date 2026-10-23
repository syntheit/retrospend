"use client";

import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { BackupCodes } from "./backup-codes";

type Step = "password" | "scan" | "codes";

/** The secret inside an otpauth:// URI, in groups of four for typing. */
export function totpSecret(uri: string): string {
	try {
		const secret = new URL(uri).searchParams.get("secret") ?? "";
		return secret.replace(/(.{4})/g, "$1 ").trim();
	} catch {
		return "";
	}
}

/**
 * Turn on two-factor (mockup): the password, then the QR code and a code
 * from the app (which is what turns it on), then the backup codes, shown
 * once, with "I saved them". Same better-auth calls as today's card.
 */
export function TwoFactorOnSheet({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDone: () => unknown;
}) {
	const t = useTranslations("settingsV2.twoFactor");
	const toast = useToast();
	const [step, setStep] = useState<Step>("password");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [uri, setUri] = useState("");
	const [codes, setCodes] = useState<string[]>([]);

	useEffect(() => {
		if (open) return;
		// Codes are shown once; nothing stays in memory after closing.
		setStep("password");
		setPassword("");
		setCode("");
		setUri("");
		setCodes([]);
	}, [open]);

	const submit = async () => {
		if (step === "password") {
			const { data, error } = await authClient.twoFactor.enable({ password });
			if (error) throw new Error(error.message || t("failed"));
			setUri(data?.method === "totp" ? data.totpURI : "");
			setCodes(data?.method === "totp" ? data.backupCodes : []);
			setPassword("");
			setStep("scan");
			return false;
		}
		if (step === "scan") {
			const { error } = await authClient.twoFactor.verifyTotp({ code });
			if (error) throw new Error(error.message || t("wrongCode"));
			toast.saved(t("turnedOn"));
			await onDone();
			if (codes.length > 0) {
				setStep("codes");
				return false;
			}
			return true;
		}
		return true;
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={open}
			submitDisabled={
				(step === "password" && !password) ||
				(step === "scan" && code.length !== 6)
			}
			submitLabel={
				step === "password"
					? t("continue")
					: step === "scan"
						? t("verify")
						: t("saved")
			}
			title={t("onTitle")}
		>
			{step === "password" && (
				<div className="flex flex-col gap-2">
					<Label htmlFor="tf-pw">{t("password")}</Label>
					<Input
						autoComplete="current-password"
						id="tf-pw"
						onChange={(e) => setPassword(e.target.value)}
						type="password"
						value={password}
					/>
				</div>
			)}
			{step === "scan" && (
				<div className="flex flex-col items-center gap-4">
					<div className="rounded-ctl border border-line-strong bg-surface p-2">
						{/* QR codes need a light ground in both themes to scan. */}
						<QRCodeSVG marginSize={1} size={160} value={uri} />
					</div>
					<p className="text-center text-fg-2 text-small">
						{t("scan")} <span className="font-mono">{totpSecret(uri)}</span>
					</p>
					<div className="flex flex-col items-center gap-2">
						<Label htmlFor="tf-code">{t("code")}</Label>
						<InputOTP
							id="tf-code"
							maxLength={6}
							onChange={setCode}
							value={code}
						>
							<InputOTPGroup>
								{[0, 1, 2, 3, 4, 5].map((i) => (
									<InputOTPSlot index={i} key={i} />
								))}
							</InputOTPGroup>
						</InputOTP>
					</div>
				</div>
			)}
			{step === "codes" && (
				<div className="flex flex-col gap-3">
					<p className="text-fg-2 text-small">{t("saveCodes")}</p>
					<BackupCodes codes={codes} />
				</div>
			)}
		</Sheet>
	);
}
