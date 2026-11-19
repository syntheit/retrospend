"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { webEnableCallbacks } from "~/lib/protection/enable";
import { KEYS_STATUS_KEY, readKeysStatus } from "~/lib/protection/keys-status";
import { api } from "~/trpc/react";
import { SettingRow } from "../setting-row";
import { EnableSheet } from "./enable-sheet";

/**
 * The Advanced protection row of Security. Not drawn until the server says it
 * offers protection (a flag that has not loaded, or is off, shows nothing), so
 * it fails closed. Then: loading, could not load with Retry, off (Turn on, or
 * the reason it cannot be turned on yet), or keys ready. Turning on opens the
 * enable sheet; the row refreshes whenever the sheet closes.
 */
export function ProtectionRow() {
	const t = useTranslations("protection");
	const toast = useToast();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const flags = api.system.getFeatureFlags.useQuery();
	const offered = flags.data?.advancedProtection === true;
	const status = useQuery({
		queryKey: KEYS_STATUS_KEY,
		queryFn: () => readKeysStatus(),
		enabled: offered,
		retry: false,
	});
	const [open, setOpen] = useState(false);
	// The row's words, which name why its button is off or what it retries.
	const metaId = useId();
	// When the keys are made, for the saved file; set when the sheet opens.
	const [made, setMade] = useState(() => new Date());
	const user = session?.user;
	const id = user?.id;
	const email = user?.email;
	// One set of callbacks for the sheet's life: it remembers the drafts it made.
	const callbacks = useMemo(
		() => (id && email ? webEnableCallbacks({ id, email }) : null),
		[id, email],
	);
	if (!offered || !user) return null;

	const verified = user.emailVerified === true;
	const row = (meta: React.ReactNode, action?: React.ReactNode) => (
		<SettingRow
			label={t("row.title")}
			meta={action ? <span id={metaId}>{meta}</span> : meta}
		>
			{action}
		</SettingRow>
	);
	if (status.isPending) return row(<Skeleton className="w-24" shape="line" />);
	if (status.isError)
		return row(
			t("row.loadFailed"),
			<Button
				aria-describedby={metaId}
				kind="secondary"
				onClick={() => void status.refetch()}
				size="sm"
			>
				{t("row.retry")}
			</Button>,
		);
	if (status.data === "keyed") return row(t("row.keysReady"));

	return (
		<>
			{row(
				verified ? t("row.off") : t("row.verifyEmailFirst"),
				<Button
					aria-describedby={metaId}
					disabled={!verified || !callbacks}
					kind="secondary"
					onClick={() => {
						setMade(new Date());
						setOpen(true);
					}}
					size="sm"
				>
					{t("row.turnOn")}
				</Button>,
			)}
			{callbacks && (
				<EnableSheet
					account={user.email}
					made={made}
					makeKeys={callbacks.makeKeys}
					onDone={() => toast.saved(t("toast.keysSaved"))}
					onOpenChange={(next) => {
						setOpen(next);
						if (!next)
							void queryClient.invalidateQueries({ queryKey: KEYS_STATUS_KEY });
					}}
					open={open}
					save={callbacks.save}
					twoFactor={user.twoFactorEnabled === true}
				/>
			)}
		</>
	);
}
