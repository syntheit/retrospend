"use client";

import {
	Check,
	ChevronRight,
	Copy,
	Globe,
	Link2,
	Lock,
	QrCode,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { env } from "~/env";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShareProjectDialogProps {
	projectId: string;
	projectName: string;
	createdById: string;
	isOrganizer: boolean;
	isEditor: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const ROLE_LABEL_KEYS: Record<string, string> = {
	ORGANIZER: "roleOwner",
	EDITOR: "roleEditor",
	CONTRIBUTOR: "roleContributor",
	VIEWER: "roleViewer",
};

// ── Component ────────────────────────────────────────────────────────────────
//
// The roster + add-people + per-person roles now live on the People tab. Share
// is link-only: public/private visibility, a copyable project link, and the
// per-role invite (magic) links. The `createdById`/`isOrganizer` props are kept
// for call-site compatibility even though roster management moved out.
export function ShareProjectDialog({
	projectId,
	projectName,
	isEditor,
	open,
	onOpenChange,
}: ShareProjectDialogProps) {
	const t = useTranslations("projects");

	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent
				className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg [&>button]:right-6 [&>button]:top-6"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<ResponsiveDialogHeader className="px-6 pt-6 pb-4">
					<ResponsiveDialogTitle>
						{t("shareViaLinkTitle", { name: projectName })}
					</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						{t("shareViaLinkDescription")}
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				<div className="flex flex-1 flex-col overflow-hidden">
					{/* Link Access */}
					<LinkAccessSection isOrganizer={isEditor} projectId={projectId} />

					{/* Invite Links (editor or organizer) */}
					{isEditor && <LinkSharingSection projectId={projectId} />}
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

// ── Link Access ──────────────────────────────────────────────────────────────

// Visibility descriptions moved to translation keys
const VISIBILITY_KEYS: Record<string, string> = {
	PRIVATE: "visibilityPrivateDesc",
	PUBLIC: "visibilityPublicDesc",
};

function LinkAccessSection({
	projectId,
	isOrganizer,
}: {
	projectId: string;
	isOrganizer: boolean;
}) {
	const t = useTranslations("projects");
	const utils = api.useUtils();
	const { data: project } = api.project.detail.useQuery({ id: projectId });
	const [copied, setCopied] = useState(false);

	const updateMutation = api.project.update.useMutation({
		onSuccess: () => {
			toast.success(t("visibilityUpdated"));
			void utils.project.detail.invalidate({ id: projectId });
			void utils.project.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const visibility = project?.visibility ?? "PRIVATE";
	const isPublic = visibility === "PUBLIC";

	const handleCopyLink = async () => {
		const url =
			typeof window !== "undefined"
				? `${window.location.origin}/projects/${projectId}`
				: `${env.NEXT_PUBLIC_APP_URL}/projects/${projectId}`;
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="border-t border-border/60 px-6 py-4">
			<div className="flex items-center gap-3">
				<div
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
						isPublic
							? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
							: "bg-muted text-muted-foreground",
					)}
				>
					{isPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
				</div>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">
						{isPublic ? t("public") : t("private")}
					</p>
					<p className="text-muted-foreground text-xs">
						{t(VISIBILITY_KEYS[visibility] ?? "visibilityPrivateDesc")}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className="h-8 w-8"
								onClick={handleCopyLink}
								size="icon"
								variant="ghost"
							>
								{copied ? (
									<Check className="h-4 w-4 text-emerald-600" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{copied ? t("copied") : t("copyLink")}
						</TooltipContent>
					</Tooltip>
					{isOrganizer && (
						<Switch
							className="cursor-pointer"
							checked={isPublic}
							onCheckedChange={(checked) =>
								updateMutation.mutate({
									id: projectId,
									visibility: checked ? "PUBLIC" : "PRIVATE",
								})
							}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Link Sharing (Invite Links) ──────────────────────────────────────────────

const LINK_ROLES = ["EDITOR", "CONTRIBUTOR", "VIEWER"] as const;
type MagicLinkRole = (typeof LINK_ROLES)[number];

function formatLinkDate(date: Date | string): string {
	return new Date(date).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

function LinkSharingSection({ projectId }: { projectId: string }) {
	const t = useTranslations("projects");
	const [open, setOpen] = useState(false);
	const { data: magicLinks, isLoading } = api.project.listMagicLinks.useQuery({
		projectId,
	});

	const linksByRole = useMemo(() => {
		const map: Partial<
			Record<MagicLinkRole, NonNullable<typeof magicLinks>[number]>
		> = {};
		for (const link of magicLinks ?? []) {
			if (
				link.roleGranted === "EDITOR" ||
				link.roleGranted === "CONTRIBUTOR" ||
				link.roleGranted === "VIEWER"
			) {
				map[link.roleGranted as MagicLinkRole] = link;
			}
		}
		return map;
	}, [magicLinks]);

	const activeCount = useMemo(() => {
		return (magicLinks ?? []).filter((l) => l.isActive).length;
	}, [magicLinks]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center border-t border-border/60 px-6 py-4">
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<Collapsible
			className="border-y border-border/60"
			onOpenChange={setOpen}
			open={open}
		>
			<CollapsibleTrigger asChild>
				<button
					className="flex h-auto w-full cursor-pointer items-center gap-3 rounded-none px-6 py-4 text-left transition-colors hover:bg-muted/50"
					type="button"
				>
					<div
						className={cn(
							"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
							activeCount > 0
								? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
								: "bg-muted text-muted-foreground",
						)}
					>
						<Link2 className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="font-medium text-sm">{t("inviteLinks")}</p>
						<p className="text-muted-foreground text-xs">
							{activeCount > 0
								? t("activeLinks", { count: activeCount })
								: t("createLinksToShare")}
						</p>
					</div>
					<ChevronRight
						className={cn(
							"h-4 w-4 text-muted-foreground transition-transform",
							open && "rotate-90",
						)}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="space-y-1 px-6 pb-4">
					{LINK_ROLES.map((role) => (
						<MagicLinkRow
							key={role}
							link={linksByRole[role]}
							projectId={projectId}
							role={role}
						/>
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function MagicLinkRow({
	role,
	link,
	projectId,
}: {
	role: MagicLinkRole;
	link:
		| {
				id: string;
				roleGranted: string;
				useCount: number;
				createdAt: Date | string;
				isActive: boolean;
		  }
		| undefined;
	projectId: string;
}) {
	const t = useTranslations("projects");
	const utils = api.useUtils();
	const [copied, setCopied] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
	const [confirmRevoke, setConfirmRevoke] = useState(false);
	const [showLink, setShowLink] = useState(false);

	const baseUrl =
		typeof window !== "undefined"
			? window.location.origin
			: env.NEXT_PUBLIC_APP_URL;
	const linkUrl = link
		? `${baseUrl}/projects/${projectId}?invite=${link.id}`
		: null;

	const createMutation = api.project.createMagicLink.useMutation({
		onSuccess: () => {
			void utils.project.listMagicLinks.invalidate({ projectId });
		},
		onError: (e) => toast.error(e.message),
	});

	const revokeMutation = api.project.revokeMagicLink.useMutation({
		onSuccess: () => {
			void utils.project.listMagicLinks.invalidate({ projectId });
			setConfirmRevoke(false);
		},
		onError: (e) => toast.error(e.message),
	});

	const resetMutation = api.project.resetMagicLink.useMutation({
		onSuccess: () => {
			void utils.project.listMagicLinks.invalidate({ projectId });
			setConfirmReset(false);
		},
		onError: (e) => toast.error(e.message),
	});

	const handleCopy = async () => {
		if (!linkUrl) return;
		await navigator.clipboard.writeText(linkUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/30">
			{!link ? (
				<div className="flex items-center gap-3">
					<div className="min-w-0 flex-1 space-y-0.5">
						<p className="font-medium text-sm">
							{t(ROLE_LABEL_KEYS[role] ?? "roleContributor")}
						</p>
						<p className="text-muted-foreground text-xs">{t("notCreated")}</p>
					</div>
					<Button
						disabled={createMutation.isPending}
						onClick={() =>
							createMutation.mutate({
								projectId,
								roleGranted: role,
							})
						}
						size="sm"
						variant="outline"
					>
						{createMutation.isPending ? t("creating") : t("create")}
					</Button>
				</div>
			) : (
				<>
					<div className="flex items-center gap-2">
						{/* Left: role info */}
						<div className="min-w-0 flex-1 space-y-0.5">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">
									{t(ROLE_LABEL_KEYS[role] ?? "roleContributor")}
								</span>
								<Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
									{t("active")}
								</Badge>
							</div>
							{/* Meta + show link toggle */}
							<p className="text-muted-foreground text-xs">
								{t("linkJoins", { count: link.useCount })} · {t("created")}{" "}
								{formatLinkDate(link.createdAt)} ·{" "}
								<Button
									className="h-auto p-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
									onClick={() => setShowLink((v) => !v)}
									type="button"
									variant="link"
								>
									{showLink ? t("hideLink") : t("showLink")}
								</Button>
							</p>
							<Collapsible open={showLink}>
								<CollapsibleContent>
									<p className="truncate pt-0.5 font-mono text-muted-foreground text-xs">
										{linkUrl}
									</p>
								</CollapsibleContent>
							</Collapsible>
						</div>
						{/* Right: action buttons */}
						<div className="flex shrink-0 items-center gap-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className="h-7 w-7"
										onClick={handleCopy}
										size="icon"
										variant="ghost"
									>
										{copied ? (
											<Check className="h-3.5 w-3.5 text-emerald-600" />
										) : (
											<Copy className="h-3.5 w-3.5" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									{copied ? t("copied") : t("copyInviteLink")}
								</TooltipContent>
							</Tooltip>
							<Popover>
								<Tooltip>
									<TooltipTrigger asChild>
										<PopoverTrigger asChild>
											<Button className="h-7 w-7" size="icon" variant="ghost">
												<QrCode className="h-3.5 w-3.5" />
											</Button>
										</PopoverTrigger>
									</TooltipTrigger>
									<TooltipContent>{t("qrCode")}</TooltipContent>
								</Tooltip>
								<PopoverContent align="end" className="w-auto p-4">
									<div className="flex flex-col items-center gap-3">
										<div className="rounded-lg bg-white p-3">
											<QRCodeSVG level="M" size={160} value={linkUrl ?? ""} />
										</div>
										<p className="text-center text-muted-foreground text-xs">
											{t("scanToJoinAs", {
												role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor"),
											})}
										</p>
									</div>
								</PopoverContent>
							</Popover>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className="h-7 w-7"
										onClick={() => setConfirmReset(true)}
										size="icon"
										variant="ghost"
									>
										<RefreshCw className="h-3.5 w-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>{t("generateNewLink")}</TooltipContent>
							</Tooltip>
							<Button
								className="h-7 px-2 text-xs text-destructive hover:text-destructive"
								onClick={() => setConfirmRevoke(true)}
								size="sm"
								variant="ghost"
							>
								{t("revoke")}
							</Button>
						</div>
					</div>
					{/* Reset confirmation dialog */}
					<AlertDialog onOpenChange={setConfirmReset} open={confirmReset}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t("generateNewRoleLink", {
										role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor"),
									})}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t("currentLinkStopWorking")}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
								<AlertDialogAction
									className={buttonVariants({ variant: "destructive" })}
									disabled={resetMutation.isPending}
									onClick={(e) => {
										e.preventDefault();
										resetMutation.mutate({ projectId, role });
									}}
								>
									{resetMutation.isPending ? t("generating") : t("generateNewLink")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					{/* Revoke confirmation dialog */}
					<AlertDialog onOpenChange={setConfirmRevoke} open={confirmRevoke}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t("revokeRoleLink", {
										role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor"),
									})}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t("revokeLinkDescription", {
										role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor"),
									})}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
								<AlertDialogAction
									className={buttonVariants({ variant: "destructive" })}
									disabled={revokeMutation.isPending}
									onClick={(e) => {
										e.preventDefault();
										revokeMutation.mutate({
											projectId,
											linkId: link.id,
										});
									}}
								>
									{revokeMutation.isPending ? t("revoking") : t("revoke")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</>
			)}
		</div>
	);
}
