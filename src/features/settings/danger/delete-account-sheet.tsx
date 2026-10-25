"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";
import { SettingRow, SettingRows } from "../setting-row";

type Preview = RouterOutputs["user"]["previewAccountDeletion"];

/** What happens to shared things, one row each (mockup step 2). */
function Consequences({ data }: { data: Preview }) {
	const t = useTranslations("settingsV2.delete");
	const rows: { key: string; title: string; meta: string }[] = [
		...data.projectsToTransfer.map((p) => ({
			key: `t-${p.id}`,
			title: p.name,
			meta: t("projectTransfer", { owner: p.newOrganizerName }),
		})),
		...data.projectsToDelete.map((p) => ({
			key: `d-${p.id}`,
			title: p.name,
			meta: t("projectDelete"),
		})),
	];
	const counts: [string, number, string][] = [
		["confirm", data.settlementsToAutoConfirm, "settlementsConfirm"],
		["cancel", data.settlementsToCancel, "settlementsCancel"],
		["accept", data.verificationsToAutoAccept, "verificationsAccept"],
		["anon", data.sharedTransactionsToAnonymize, "sharedAnonymize"],
	];
	for (const [key, count, msg] of counts)
		if (count > 0)
			rows.push({
				key,
				title: t(`${msg}.title`, { count }),
				meta: t(`${msg}.meta`),
			});
	rows.push({ key: "own", title: t("own.title"), meta: t("own.meta") });
	return (
		<SettingRows>
			{rows.map((r) => (
				<SettingRow key={r.key} label={r.title} meta={r.meta} />
			))}
		</SettingRows>
	);
}

/**
 * Delete account in two steps (mockup): the password, then what happens to
 * shared things and a danger "Delete my account". Same preview and delete
 * calls as today's dialog; a wrong password brings the first step back.
 */
export function DeleteAccountSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("settingsV2.delete");
	const toast = useToast();
	const router = useRouter();
	const [step, setStep] = useState<"password" | "confirm">("password");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const preview = api.user.previewAccountDeletion.useQuery(undefined, {
		enabled: open,
		staleTime: 60_000,
	});
	const remove = api.user.deleteAccount.useMutation();

	useEffect(() => {
		if (open) return;
		setStep("password");
		setPassword("");
		setError(null);
	}, [open]);

	const destroy = async () => {
		setError(null);
		try {
			await remove.mutateAsync({ password });
			toast.saved(t("deleted"));
			router.push("/login");
		} catch (err) {
			setStep("password");
			setError(err instanceof Error ? err.message : t("failed"));
		}
	};

	const onlyAdmin = preview.data?.onlyAdmin === true;

	const footer = onlyAdmin ? (
		<Button kind="secondary" onClick={() => onOpenChange(false)}>
			{t("cancel")}
		</Button>
	) : step === "password" ? (
			<>
				<Button kind="secondary" onClick={() => onOpenChange(false)}>
					{t("cancel")}
				</Button>
				<Button
					disabled={!password}
					kind="secondary"
					onClick={() => setStep("confirm")}
				>
					{t("continue")}
				</Button>
			</>
		) : (
			<>
				<Button kind="secondary" onClick={() => onOpenChange(false)}>
					{t("cancel")}
				</Button>
				<Button
					disabled={!preview.data}
					kind="danger"
					loading={remove.isPending}
					onClick={() => void destroy()}
				>
					{t("confirm")}
				</Button>
			</>
		);

	return (
		<Sheet
			description={
				step === "password" && !onlyAdmin ? t("passwordBody") : undefined
			}
			footer={footer}
			onOpenChange={onOpenChange}
			open={open}
			title={t("title")}
		>
			{onlyAdmin ? (
				<div className="text-small flex flex-col gap-2">
					<p className="text-fg" role="alert">
						{t("onlyAdmin")}
					</p>
					<Link
						className="rounded-ctl text-accent-strong focus-visible:outline-brand can-hover:hover:underline w-fit font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
						href="/admin"
					>
						{t("onlyAdminLink")}
					</Link>
				</div>
			) : step === "password" ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor="del-pw">{t("password")}</Label>
					<Input
						autoComplete="current-password"
						id="del-pw"
						onChange={(e) => {
							setPassword(e.target.value);
							setError(null);
						}}
						type="password"
						value={password}
					/>
					{error && (
						<p className="text-danger text-small" role="alert">
							{error}
						</p>
					)}
				</div>
			) : preview.data ? (
				<Consequences data={preview.data} />
			) : preview.isError ? (
				<p className="text-danger text-small">{t("previewFailed")}</p>
			) : (
				<p className="text-fg-3 text-small">{t("loading")}</p>
			)}
		</Sheet>
	);
}
