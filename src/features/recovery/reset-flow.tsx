"use client";

import type { RecoveryCallbacks } from "@retrospend/crypto/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import {
	checkRecoveryLink,
	webRecoveryCallbacks,
} from "~/lib/protection/recovery";
import { PlainResetForm } from "./plain-reset-form";
import { RecoverSheet } from "./recover-sheet";
import { RecoveryChoices } from "./recovery-choices";

type View = "choices" | "plain";

/**
 * What the reset link leads to. The link is checked first (it spends no try):
 * an account without keys, and a link the check does not know (an admin's
 * link), get today's form; one with keys gets the choices, and the recovery
 * key opens the recovery sheet. A link that cannot be checked
 * is never read as "no keys", so the plain form is not shown on a guess.
 */
export function ResetFlow({ token }: { token: string }) {
	const t = useTranslations("auth");
	const p = useTranslations("protection");
	const toast = useToast();
	const router = useRouter();
	const link = useQuery({
		queryKey: ["auth", "recovery-link", token],
		queryFn: () => checkRecoveryLink(token),
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const [view, setView] = useState<View>("choices");
	const [open, setOpen] = useState(false);
	// One set of callbacks for the sheet's life: it remembers the handles it made.
	const callbacks = useMemo<RecoveryCallbacks>(
		() => webRecoveryCallbacks(token),
		[token],
	);

	if (link.isPending)
		return (
			<AuthPanel busy>
				<Skeleton shape="line" />
			</AuthPanel>
		);
	if (link.isError)
		return (
			<AuthPanel description={p("recover.linkFailed")}>
				<Button
					className="w-full"
					kind="secondary"
					onClick={() => void link.refetch()}
				>
					{p("row.retry")}
				</Button>
			</AuthPanel>
		);
	// A link the recovery check does not know is not a dead link: an admin's
	// link opens a plain reset and never recovery, and the check answers 404 for
	// it. The server judges the token at submit, as it did before recovery
	// (unknown or expired: "Invalid or expired token"; a protected account: refused).
	if (link.data === "invalid" || link.data.keys === "none")
		return <PlainResetForm token={token} />;
	if (view === "plain")
		return <PlainResetForm onBack={() => setView("choices")} token={token} />;

	return (
		<>
			<RecoveryChoices
				onReset={() => setView("plain")}
				onUseKey={() => setOpen(true)}
				protectionOn={link.data.protectionOn}
			/>
			<RecoverSheet
				begin={callbacks.begin}
				finish={callbacks.finish}
				onDone={(result) => {
					// A spent link after a lost answer is not proof of a new password:
					// say to sign in with it, and the sign-in tells.
					if (result === "set") toast.saved(t("passwordUpdatedSuccessfully"));
					else toast.info(p("recover.signInNew"));
					router.push("/login");
				}}
				onOpenChange={setOpen}
				open={open}
				preset={link.data.keys === "noRecovery" ? "unavailable" : null}
			/>
		</>
	);
}
