import { AlertCircle, CheckCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { handleError } from "~/lib/handle-error";
import { api } from "~/trpc/react";

type InviteState = "idle" | "validating" | "success" | "error";

export function useInviteCode() {
	const t = useTranslations("auth");
	const searchParams = useSearchParams();
	const utils = api.useUtils();
	const [inviteCode, setInviteCode] = useState("");
	const [inviteState, setInviteState] = useState<InviteState>("idle");
	const [inviteError, setInviteError] = useState("");

	const validateInviteCode = useCallback(
		async (code: string) => {
			if (code.length !== 8) return;

			setInviteState("validating");
			setInviteError("");

			try {
				const result = await utils.invite.validate.fetch({ code });

				if (result.valid) {
					setInviteState("success");
					// biome-ignore lint/suspicious/noDocumentCookie: Cookie must be set client-side for better-auth server-side validation
					document.cookie = `retro_invite_code=${code}; path=/; max-age=86400; Secure; SameSite=Strict`;
				} else {
					setInviteState("error");
					setInviteError(t("invalidOrExpiredInviteCode"));
				}
			} catch (error) {
				setInviteState("error");
				handleError(error, "Failed to validate invite code");
			}
		},
		[utils, t],
	);

	useEffect(() => {
		const codeParam = searchParams.get("code");
		if (codeParam && inviteState === "idle") {
			const uppercaseCode = codeParam.toUpperCase();
			setInviteCode(uppercaseCode);
			validateInviteCode(uppercaseCode);
		}
	}, [searchParams, inviteState, validateInviteCode]);

	const onChange = (value: string) => {
		const uppercaseValue = value.toUpperCase();
		setInviteCode(uppercaseValue);
		setInviteError("");

		if (uppercaseValue.length === 8) {
			validateInviteCode(uppercaseValue);
		} else if (inviteState !== "idle") {
			setInviteState("idle");
		}
	};

	return { inviteCode, inviteState, inviteError, onChange };
}

export function InviteCodeField({
	inviteCode,
	inviteState,
	inviteError,
	onChange,
}: ReturnType<typeof useInviteCode>) {
	const t = useTranslations("auth");
	const showInviteInput = inviteState === "idle" || inviteState === "error";

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<Label htmlFor="inviteCode">{t("inviteCode")}</Label>
				{inviteState === "success" && (
					<Badge className="flex items-center gap-1" variant="default">
						<CheckCircle className="h-3 w-3" />
						{t("accepted")}
					</Badge>
				)}
			</div>

			{showInviteInput && (
				<div className="space-y-2">
					<InputOTP maxLength={8} onChange={onChange} value={inviteCode}>
						<InputOTPGroup>
							<InputOTPSlot index={0} />
							<InputOTPSlot index={1} />
							<InputOTPSlot index={2} />
							<InputOTPSlot index={3} />
							<InputOTPSlot index={4} />
							<InputOTPSlot index={5} />
							<InputOTPSlot index={6} />
							<InputOTPSlot index={7} />
						</InputOTPGroup>
					</InputOTP>
					<p className="text-muted-foreground text-xs">
						{t("enterInviteCode")}
					</p>
				</div>
			)}

			{inviteState === "validating" && (
				<div className="bg-muted flex items-center gap-2 rounded-ctl p-3">
					<div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
					<span className="text-sm">{t("validatingInviteCode")}</span>
				</div>
			)}

			{inviteState === "success" && (
				<div className="flex items-center gap-2 rounded-ctl bg-positive/10 p-3">
					<CheckCircle className="h-4 w-4 text-positive" />
					<span className="text-positive text-sm">{t("inviteAccepted")}</span>
				</div>
			)}

			{inviteError && (
				<div className="flex items-center gap-2 rounded-ctl bg-danger-bg p-3">
					<AlertCircle className="text-destructive h-4 w-4" />
					<span className="text-danger text-sm">{inviteError}</span>
				</div>
			)}
		</div>
	);
}
