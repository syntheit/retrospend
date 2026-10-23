"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { BackupCodes } from "./backup-codes";

type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

function PasswordField({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	const t = useTranslations("settingsV2.twoFactor");
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="tf-off-pw">{t("password")}</Label>
			<Input
				autoComplete="current-password"
				id="tf-off-pw"
				onChange={(e) => onChange(e.target.value)}
				type="password"
				value={value}
			/>
		</div>
	);
}

/**
 * Backup codes: the server keeps them encrypted and the web client cannot
 * read them back (GAPS), so this sheet makes a new set with the password,
 * named for what it does ("Make new codes": the old ones stop working),
 * and shows the new set once.
 */
export function BackupCodesSheet({ open, onOpenChange }: SheetProps) {
	const t = useTranslations("settingsV2.twoFactor");
	const toast = useToast();
	const [password, setPassword] = useState("");
	const [codes, setCodes] = useState<string[]>([]);

	useEffect(() => {
		if (open) return;
		setPassword("");
		setCodes([]);
	}, [open]);

	const make = async () => {
		const { data, error } = await authClient.twoFactor.generateBackupCodes({
			password,
		});
		if (error) throw new Error(error.message || t("failed"));
		setCodes(data?.backupCodes ?? []);
		setPassword("");
		toast.saved(t("newCodesMade"));
		return false;
	};

	return (
		<Sheet
			description={codes.length ? undefined : t("codesBody")}
			onOpenChange={onOpenChange}
			onSubmit={codes.length ? () => true : make}
			open={open}
			submitDisabled={!codes.length && !password}
			submitLabel={codes.length ? t("done") : t("makeCodes")}
			title={t("codesTitle")}
		>
			{codes.length ? (
				<BackupCodes codes={codes} />
			) : (
				<PasswordField onChange={setPassword} value={password} />
			)}
		</Sheet>
	);
}

/** Turn off two-factor: the password, then a danger "Turn off". */
export function TwoFactorOffSheet({
	open,
	onOpenChange,
	onDone,
}: SheetProps & { onDone: () => unknown }) {
	const t = useTranslations("settingsV2.twoFactor");
	const toast = useToast();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) return;
		setPassword("");
		setError(null);
	}, [open]);

	const turnOff = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await authClient.twoFactor.disable({ password });
			if (res.error) {
				setError(res.error.message || t("failed"));
				return;
			}
			toast.saved(t("turnedOff"));
			await onDone();
			onOpenChange(false);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet
			description={t("offBody")}
			footer={
				<>
					<Button kind="secondary" onClick={() => onOpenChange(false)}>
						{t("cancel")}
					</Button>
					<Button
						disabled={!password}
						kind="danger"
						loading={busy}
						onClick={() => void turnOff()}
					>
						{t("turnOff")}
					</Button>
				</>
			}
			onOpenChange={onOpenChange}
			open={open}
			title={t("offTitle")}
		>
			<PasswordField onChange={setPassword} value={password} />
			{error && (
				<p className="mt-2 text-danger text-small" role="alert">
					{error}
				</p>
			)}
		</Sheet>
	);
}
