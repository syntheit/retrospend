"use client";

import { useTranslations } from "next-intl";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { PageView } from "../types";

const ROLES = ["CONTRIBUTOR", "VIEWER"] as const;

/**
 * Share: one invite link per role (can add expenses, can view), each with
 * Copy, a new link (the old one stops working) and Turn off; and the public
 * page switch. Editors manage links; the public switch is the owner's.
 */
export function ShareSheet({
	view,
	onOpenChange,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.share");
	const te = useTranslations("projectV2.errors");
	const toast = useToast();
	const utils = api.useUtils();
	const links = api.project.listMagicLinks.useQuery({ projectId: view.id });
	const again = () =>
		utils.project.listMagicLinks.invalidate({ projectId: view.id });
	// Failures say so in our words, never the server's text.
	const onError = () => toast.failed(te("failed"));
	const create = api.project.createMagicLink.useMutation({
		onSuccess: again,
		onError,
	});
	const reset = api.project.resetMagicLink.useMutation({
		onSuccess: again,
		onError,
	});
	const revoke = api.project.revokeMagicLink.useMutation({
		onSuccess: again,
		onError,
	});
	const update = api.project.update.useMutation({
		onSuccess: () => utils.project.invalidate(),
	});
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const copy = async (text: string) => {
		await navigator.clipboard.writeText(text);
		toast.info(t("copied"));
	};
	const isPublic = view.visibility === "PUBLIC";
	const setPublic = async (on: boolean) => {
		const to = on ? "PUBLIC" : "PRIVATE";
		const back = on ? "PRIVATE" : "PUBLIC";
		try {
			await update.mutateAsync({ id: view.id, visibility: to });
		} catch {
			toast.failed(te("failed"));
			return;
		}
		toast.saved(on ? t("nowPublic") : t("nowPrivate"), {
			undo: () => update.mutateAsync({ id: view.id, visibility: back }),
		});
	};

	return (
		<Sheet footer={false} onOpenChange={onOpenChange} open title={t("title")}>
			<div className="flex flex-col gap-6 pb-4">
				<RowList label={t("links")} variant="flat">
					{ROLES.map((role) => {
						const link = links.data?.find((l) => l.roleGranted === role);
						const url = link
							? `${origin}/projects/${view.id}?invite=${link.id}`
							: null;
						return (
							<Row
								end={
									url && link ? (
										<span className="flex gap-2">
											<Button
												kind="secondary"
												onClick={() => copy(url)}
												size="sm"
											>
												{t("copy")}
											</Button>
											<Button
												kind="ghost"
												onClick={() =>
													reset.mutate({ projectId: view.id, role })
												}
												size="sm"
											>
												{t("newLink")}
											</Button>
											<Button
												kind="ghost"
												onClick={() =>
													revoke.mutate({ projectId: view.id, linkId: link.id })
												}
												size="sm"
											>
												{t("turnOff")}
											</Button>
										</span>
									) : (
										<Button
											kind="secondary"
											loading={create.isPending}
											onClick={() =>
												create.mutate({ projectId: view.id, roleGranted: role })
											}
											size="sm"
										>
											{t("create")}
										</Button>
									)
								}
								key={role}
								sub={<RowSub parts={[url ? t("on") : t("off")]} />}
								title={t(`roles.${role}`)}
							/>
						);
					})}
				</RowList>
				<div className="flex flex-col gap-2">
					<div className="min-h-ctl flex items-center justify-between gap-3">
						<Label htmlFor="sh-public">{t("public")}</Label>
						<Switch
							checked={isPublic}
							disabled={view.myRole !== "ORGANIZER" || update.isPending}
							id="sh-public"
							onCheckedChange={(on) => void setPublic(on)}
						/>
					</div>
					<p className="text-fg-3 text-meta">{t("publicHint")}</p>
					{isPublic ? (
						<Button
							className="self-start"
							kind="secondary"
							onClick={() => copy(`${origin}/projects/${view.id}`)}
							size="sm"
						>
							{t("copyPublic")}
						</Button>
					) : null}
				</div>
			</div>
		</Sheet>
	);
}
