"use client";

import {
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Ghost,
	Globe,
	Link2,
	Lock,
	QrCode,
	Loader2,
	RefreshCw,
	Search,
	UserPlus,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "~/components/ui/user-avatar";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useSession } from "~/hooks/use-session";
import { useRebalanceOnAdd } from "~/hooks/use-rebalance-on-add";
import { useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { env } from "~/env";

// ── Types ────────────────────────────────────────────────────────────────────

interface Participant {
	id: string;
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	email: string | null;
	username: string | null;
	avatarUrl: string | null;
	joinedAt: Date;
}

interface ShareProjectDialogProps {
	projectId: string;
	projectName: string;
	createdById: string;
	isOrganizer: boolean;
	isEditor: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const ROLE_ORDER: Record<string, number> = {
	ORGANIZER: 0,
	EDITOR: 1,
	CONTRIBUTOR: 2,
	VIEWER: 3,
};

const ROLE_LABEL_KEYS: Record<string, string> = {
	ORGANIZER: "roleOwner",
	EDITOR: "roleEditor",
	CONTRIBUTOR: "roleContributor",
	VIEWER: "roleViewer",
};

// ── Component ────────────────────────────────────────────────────────────────

export function ShareProjectDialog({
	projectId,
	projectName,
	createdById,
	isOrganizer,
	isEditor,
	open,
	onOpenChange,
}: ShareProjectDialogProps) {
	const t = useTranslations("projects");
	const { data: session } = useSession();
	const userId = session?.user?.id;

	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent
				className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg [&>button]:right-6 [&>button]:top-6"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<ResponsiveDialogHeader className="px-6 pt-6 pb-4">
					<ResponsiveDialogTitle>{t("shareProject", { name: projectName })}</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						{t("manageWhoHasAccess")}
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				<div className="flex flex-1 flex-col overflow-hidden">
					{/* Add People (editor or organizer) */}
					{isEditor && (
						<div className="px-6 pb-4">
							<AddPeopleSearch
								projectId={projectId}
							/>
						</div>
					)}

					{/* Link Access */}
					<LinkAccessSection
						isOrganizer={isEditor}
						projectId={projectId}
					/>

					{/* Invite Links (editor or organizer) */}
					{isEditor && (
						<LinkSharingSection
							projectId={projectId}
						/>
					)}

					{/* Participants */}
					<ParticipantList
						createdById={createdById}
						isOrganizer={isOrganizer}
						isEditor={isEditor}
						projectId={projectId}
						projectName={projectName}
						userId={userId}
					/>
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

// ── Add People Search ────────────────────────────────────────────────────────

function AddPeopleSearch({ projectId }: { projectId: string }) {
	const t = useTranslations("projects");
	const [search, setSearch] = useState("");
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [showNewContact, setShowNewContact] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const utils = api.useUtils();
	// After adding someone, offer to fold them into existing project expenses.
	const { promptRebalance, rebalanceElement } = useRebalanceOnAdd(projectId);

	const searchQuery = search.startsWith("@") ? search.slice(1) : search;

	const { data: searchResults, isFetching } = api.people.search.useQuery(
		{ query: searchQuery },
		{ enabled: searchQuery.length >= 1 },
	);

	const { data: project } = api.project.detail.useQuery({ id: projectId });
	const existingKeys = useMemo(() => {
		if (!project?.participants) return new Set<string>();
		return new Set(
			project.participants.map(
				(p) => `${p.participantType}:${p.participantId}`,
			),
		);
	}, [project?.participants]);

	const allResults = useMemo(() => {
		if (!searchResults) return [];
		return [
			...searchResults.users.map((u) => ({ ...u, avatarUrl: u.avatarUrl })),
			...searchResults.shadows,
		];
	}, [searchResults]);

	const filteredResults = useMemo(
		() =>
			allResults.filter(
				(r) =>
					!existingKeys.has(`${r.participantType}:${r.participantId}`),
			),
		[allResults, existingKeys],
	);

	const alreadyInProject = useMemo(
		() =>
			allResults.filter((r) =>
				existingKeys.has(`${r.participantType}:${r.participantId}`),
			),
		[allResults, existingKeys],
	);

	const addMutation = api.project.addParticipant.useMutation();

	const createShadowMutation = api.people.createShadow.useMutation();

	// Adds a participant, then offers to fold them into past expenses. Shared by
	// the search-select path and the new-contact path so both prompt identically.
	const addParticipant = useCallback(
		async (participant: {
			participantType: "user" | "guest" | "shadow";
			participantId: string;
			name: string;
		}) => {
			try {
				await addMutation.mutateAsync({
					projectId,
					participantType: participant.participantType,
					participantId: participant.participantId,
					role: "CONTRIBUTOR",
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : "";
				if (message.includes("already in the project")) {
					toast.info(t("alreadyInProject"));
				} else {
					toast.error(message);
				}
				return;
			}
			toast.success(t("participantAdded"));
			await utils.project.detail.invalidate({ id: projectId });
			setSearch("");
			setPopoverOpen(false);
			// Fold the newcomer into eligible past expenses (organizer/editor only).
			promptRebalance(participant);
		},
		[projectId, addMutation, utils, t, promptRebalance],
	);

	const handleSelect = useCallback(
		(participant: {
			participantType: string;
			participantId: string;
			name: string;
		}) => {
			if (
				existingKeys.has(
					`${participant.participantType}:${participant.participantId}`,
				)
			) {
				toast.info(t("alreadyInProject"));
				return;
			}
			void addParticipant({
				participantType: participant.participantType as
					| "user"
					| "guest"
					| "shadow",
				participantId: participant.participantId,
				name: participant.name,
			});
		},
		[existingKeys, addParticipant, t],
	);

	const handleCreateShadow = useCallback(async () => {
		if (!newName.trim()) return;
		try {
			const result = await createShadowMutation.mutateAsync({
				name: newName.trim(),
				email: newEmail.trim() || undefined,
			});
			setNewName("");
			setNewEmail("");
			setShowNewContact(false);
			await addParticipant({
				participantType: "shadow",
				participantId: result.participantId,
				name: result.name,
			});
		} catch {
			toast.error(t("failedToCreateContact"));
		}
	}, [newName, newEmail, createShadowMutation, addParticipant, t]);

	const isEmailLike = searchQuery.includes("@") && searchQuery.includes(".");
	const noExactMatch =
		searchQuery.length >= 1 &&
		!isFetching &&
		filteredResults.length === 0 &&
		alreadyInProject.length === 0;

	return (
		<>
		<Popover onOpenChange={setPopoverOpen} open={popoverOpen}>
			<PopoverAnchor asChild>
				<div className="relative">
					<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						autoComplete="one-time-code"
						className="pl-9"
						data-1p-ignore
						data-bwignore
						data-lpignore="true"
						onChange={(e) => {
							setSearch(e.target.value);
							setShowNewContact(false);
							if (!popoverOpen && e.target.value.length > 0)
								setPopoverOpen(true);
						}}
						onFocus={() => {
							if (search.length > 0) setPopoverOpen(true);
						}}
						placeholder={t("addPeoplePlaceholder")}
						ref={inputRef}
						value={search}
					/>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				className="w-[var(--radix-popover-anchor-width)] p-0"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<div
					className="max-h-64 overflow-y-auto overscroll-contain"
					onTouchMove={(e) => e.stopPropagation()}
					onWheel={(e) => e.stopPropagation()}
				>
					{/* Matching results not yet in project */}
					{filteredResults.length > 0 && (
						<div className="flex flex-col p-1">
							{filteredResults.map((r) => (
								<Button
									className="h-auto w-full justify-start gap-2 px-3 py-2"
									disabled={addMutation.isPending}
									key={`${r.participantType}:${r.participantId}`}
									onClick={() => handleSelect(r)}
									type="button"
									variant="ghost"
								>
									<div
										className={cn(
											"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
											r.participantType === "user"
												? "bg-primary/10 text-primary"
												: "border border-dashed border-muted-foreground/40 bg-muted text-muted-foreground",
										)}
									>
										{r.participantType === "shadow" ? (
											<Ghost className="h-3.5 w-3.5" />
										) : (
											r.name.charAt(0).toUpperCase()
										)}
									</div>
									<div className="flex flex-col items-start">
										<span className="text-sm">{r.name}</span>
										{"username" in r && r.username ? (
											<span className="text-muted-foreground text-xs">@{r.username}</span>
										) : "email" in r && r.email ? (
											<span className="text-muted-foreground text-xs">{r.email}</span>
										) : null}
									</div>
									<Badge
										className="ml-auto text-[10px]"
										variant="outline"
									>
										{r.participantType === "user"
											? t("user")
											: t("contact")}
									</Badge>
								</Button>
							))}
						</div>
					)}

					{/* Already in project */}
					{alreadyInProject.length > 0 &&
						filteredResults.length === 0 && (
							<div className="p-3 text-center text-muted-foreground text-sm">
								{t("personAlreadyInProject", { name: alreadyInProject[0]?.name ?? "" })}
							</div>
						)}

					{/* No match: email case */}
					{noExactMatch && isEmailLike && !showNewContact && (
						<div className="space-y-1 p-3">
							<p className="text-muted-foreground text-sm">
								{t("noAccountFoundFor")}{" "}
								<span className="font-medium text-foreground">
									{search}
								</span>
							</p>
							<Button
								className="w-full justify-start gap-2"
								onClick={() => {
									setShowNewContact(true);
									setNewName("");
									setNewEmail(search);
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								<UserPlus className="h-4 w-4" />
								{t("addAsShadowProfile")}
							</Button>
						</div>
					)}

					{/* No match: name case */}
					{noExactMatch && !isEmailLike && !showNewContact && (
						<div className="p-2">
							<Button
								className="w-full justify-start gap-2"
								onClick={() => {
									setShowNewContact(true);
									setNewName(searchQuery);
									setNewEmail("");
								}}
								type="button"
								variant="ghost"
							>
								<UserPlus className="h-4 w-4" />
								{t("addAsNewContact", { name: search })}
							</Button>
						</div>
					)}

					{/* Inline new contact form */}
					{showNewContact && (
						<div className="space-y-2 p-3">
							<p className="font-medium text-sm">{t("newContact")}</p>
							<Input
								autoFocus
								onChange={(e) => setNewName(e.target.value)}
								placeholder={t("name")}
								value={newName}
							/>
							<Input
								onChange={(e) => setNewEmail(e.target.value)}
								placeholder={t("emailOptional")}
								type="email"
								value={newEmail}
							/>
							<div className="flex justify-end gap-2">
								<Button
									onClick={() => {
										setShowNewContact(false);
										setNewName("");
										setNewEmail("");
									}}
									size="sm"
									type="button"
									variant="ghost"
								>
									{t("cancel")}
								</Button>
								<Button
									disabled={
										!newName.trim() ||
										createShadowMutation.isPending
									}
									onClick={handleCreateShadow}
									size="sm"
									type="button"
								>
									{createShadowMutation.isPending
										? t("adding")
										: t("add")}
								</Button>
							</div>
						</div>
					)}

					{/* Loading */}
					{isFetching && filteredResults.length === 0 && (
						<div className="p-4 text-center text-muted-foreground text-sm">
							{t("searching")}
						</div>
					)}

					{/* Empty search */}
					{search.length === 0 && (
						<div className="p-4 text-center text-muted-foreground text-sm">
							{t("typeNameOrEmail")}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
		{rebalanceElement}
		</>
	);
}

// ── Participant List ─────────────────────────────────────────────────────────

function ParticipantList({
	projectId,
	projectName,
	createdById,
	isOrganizer,
	isEditor,
	userId,
}: {
	projectId: string;
	projectName: string;
	createdById: string;
	isOrganizer: boolean;
	isEditor: boolean;
	userId: string | undefined;
}) {
	const t = useTranslations("projects");
	const { data: project } = api.project.detail.useQuery({ id: projectId });
	const participants = project?.participants ?? [];
	const utils = api.useUtils();

	const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
	const [transferTarget, setTransferTarget] = useState<Participant | null>(null);

	const isOwner = userId === createdById;

	const updateRoleMutation = api.project.updateParticipantRole.useMutation({
		onSuccess: () => {
			toast.success(t("roleUpdated"));
			void utils.project.detail.invalidate({ id: projectId });
		},
		onError: (e) => toast.error(e.message),
	});

	const removeMutation = api.project.removeParticipant.useMutation({
		onSuccess: () => {
			toast.success(t("participantRemoved"));
			void utils.project.detail.invalidate({ id: projectId });
			setRemoveTarget(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const transferMutation = api.project.transferOwnership.useMutation({
		onSuccess: () => {
			toast.success(t("ownershipTransferred"));
			void utils.project.detail.invalidate({ id: projectId });
			setTransferTarget(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const isCreator = useCallback(
		(p: Participant) =>
			p.participantType === "user" && p.participantId === createdById,
		[createdById],
	);
	const isCurrentUser = useCallback(
		(p: Participant) =>
			p.participantType === "user" && p.participantId === userId,
		[userId],
	);

	const sorted = useMemo(() => {
		return [...participants].sort((a, b) => {
			// Owner (creator) first
			const aOwner = isCreator(a) ? -1 : 0;
			const bOwner = isCreator(b) ? -1 : 0;
			if (aOwner !== bOwner) return aOwner - bOwner;
			// Current user second
			const aMe = isCurrentUser(a) ? -1 : 0;
			const bMe = isCurrentUser(b) ? -1 : 0;
			if (aMe !== bMe) return aMe - bMe;
			// Then by role
			const aRole = ROLE_ORDER[a.role] ?? 99;
			const bRole = ROLE_ORDER[b.role] ?? 99;
			if (aRole !== bRole) return aRole - bRole;
			// Then alphabetical
			return a.name.localeCompare(b.name);
		});
	}, [participants, isCurrentUser, isCreator]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="px-6 pt-3 pb-2">
				<p className="font-medium tabular-nums text-muted-foreground text-xs">
					{t("peopleWithAccess", { count: participants.length })}
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-4 pb-4">
				<div className="space-y-0.5">
					{sorted.map((p) => (
						<div
							className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
							key={p.id}
						>
							{/* Avatar */}
							<ParticipantAvatar participant={p} />

							{/* Name + status line */}
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="truncate font-medium text-sm">
										{p.name}
									</span>
									{isCurrentUser(p) && (
										<span className="text-muted-foreground text-xs">
											({t("you")})
										</span>
									)}
								</div>
								<ParticipantStatusLine participant={p} />
							</div>

							{/* Role control */}
							{isCreator(p) ? (
								<span className="shrink-0 px-2 py-1 text-muted-foreground text-xs">
									{t("roleOwner")}
								</span>
							) : isOrganizer ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											className="h-auto shrink-0 gap-1 px-2 py-1 text-xs"
											variant="ghost"
											size="sm"
										>
											{t(ROLE_LABEL_KEYS[p.role] ?? "roleContributor")}
											<ChevronDown className="h-3 w-3 opacity-50" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuRadioGroup
											onValueChange={(role) =>
												updateRoleMutation.mutate({
													projectId,
													participantType: p.participantType as
														| "user"
														| "guest"
														| "shadow",
													participantId: p.participantId,
													role: role as
														| "EDITOR"
														| "CONTRIBUTOR"
														| "VIEWER",
												})
											}
											value={p.role}
										>
											<DropdownMenuRadioItem value="EDITOR">
												{t("roleEditor")}
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="CONTRIBUTOR">
												{t("roleContributor")}
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="VIEWER">
												{t("roleViewer")}
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
										<DropdownMenuSeparator />
										{isOwner && p.participantType === "user" && (
											<DropdownMenuItem
												onClick={() => setTransferTarget(p)}
											>
												{t("transferOwnership")}
											</DropdownMenuItem>
										)}
										<DropdownMenuItem
											onClick={() => setRemoveTarget(p)}
											variant="destructive"
										>
											{t("removeAccess")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<Badge
									className="text-[10px]"
									variant="outline"
								>
									{t(ROLE_LABEL_KEYS[p.role] ?? "roleContributor")}
								</Badge>
							)}
						</div>
					))}
				</div>
			</div>

			{/* Remove Confirmation */}
			{removeTarget && (
				<RemoveConfirmation
					isPending={removeMutation.isPending}
					onCancel={() => setRemoveTarget(null)}
					onConfirm={() =>
						removeMutation.mutate({
							projectId,
							participantType: removeTarget.participantType as
								| "user"
								| "guest"
								| "shadow",
							participantId: removeTarget.participantId,
						})
					}
					participantName={removeTarget.name}
				/>
			)}

			{/* Transfer Ownership Confirmation */}
			<TransferOwnershipDialog
				open={!!transferTarget}
				onOpenChange={(open) => { if (!open) setTransferTarget(null); }}
				isPending={transferMutation.isPending}
				onConfirm={() => {
					if (!transferTarget) return;
					transferMutation.mutate({
						projectId,
						newOwnerParticipantId: transferTarget.participantId,
						confirmProjectName: projectName,
					});
				}}
				participantName={transferTarget?.name ?? ""}
				projectName={projectName}
			/>
		</div>
	);
}

function ParticipantAvatar({ participant }: { participant: Participant }) {
	const p = participant;
	if (p.participantType === "shadow") {
		return (
			<div className="relative">
				<UserAvatar name={p.name} size="sm" />
				<Link2 className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full bg-background text-muted-foreground" />
			</div>
		);
	}
	return (
		<UserAvatar
			avatarUrl={p.avatarUrl}
			name={p.name}
			size="sm"
		/>
	);
}

function ParticipantStatusLine({ participant }: { participant: Participant }) {
	const t = useTranslations("projects");
	const p = participant;
	if (p.participantType === "shadow") {
		return (
			<p className="truncate text-muted-foreground text-xs">
				{p.email ?? t("shadowProfileNoAccount")}
			</p>
		);
	}
	if (p.participantType === "guest") {
		return (
			<p className="truncate text-muted-foreground text-xs">
				{p.email ? `${p.email} \u00b7 ` : ""}{t("guestViaInviteLink")}
			</p>
		);
	}
	if (p.username) {
		return (
			<p className="truncate text-muted-foreground text-xs">@{p.username}</p>
		);
	}
	return null;
}

function RemoveConfirmation({
	participantName,
	isPending,
	onConfirm,
	onCancel,
}: {
	participantName: string;
	isPending: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const t = useTranslations("projects");
	return (
		<div className="border-border border-t bg-destructive/5 px-6 py-3">
			<p className="font-medium text-sm">
				{t("removeFromProject", { name: participantName })}
			</p>
			<p className="mt-0.5 text-muted-foreground text-xs">
				{t("existingExpensesRemain")}
			</p>
			<div className="mt-2 flex justify-end gap-2">
				<Button onClick={onCancel} size="sm" variant="ghost">
					{t("cancel")}
				</Button>
				<Button
					disabled={isPending}
					onClick={onConfirm}
					size="sm"
					variant="destructive"
				>
					{isPending ? t("removing") : t("remove")}
				</Button>
			</div>
		</div>
	);
}

function TransferOwnershipDialog({
	open,
	onOpenChange,
	isPending,
	onConfirm,
	participantName,
	projectName,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isPending: boolean;
	onConfirm: () => void;
	participantName: string;
	projectName: string;
}) {
	const t = useTranslations("projects");
	const [confirmText, setConfirmText] = useState("");
	const matches = confirmText === projectName;

	return (
		<AlertDialog open={open} onOpenChange={(v) => { if (!v) setConfirmText(""); onOpenChange(v); }}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("transferOwnership")}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3">
							<p>
								{t("transferOwnershipIntro", { name: participantName })}
							</p>
							<p>
								{t("transferOwnershipWarning")}
							</p>
							<p>
								{t("typeToConfirm", { name: projectName })}
							</p>
							<Input
								value={confirmText}
								onChange={(e) => setConfirmText(e.target.value)}
								placeholder={projectName}
								autoComplete="off"
							/>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>{t("cancel")}</AlertDialogCancel>
					<AlertDialogAction
						disabled={!matches || isPending}
						onClick={(e) => { e.preventDefault(); onConfirm(); }}
						className="bg-destructive text-white hover:bg-destructive/90"
					>
						{isPending ? t("transferring") : t("transferOwnership")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
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
				<div className={cn(
					"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
					isPublic
						? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
						: "bg-muted text-muted-foreground",
				)}>
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

function LinkSharingSection({
	projectId,
}: {
	projectId: string;
}) {
	const t = useTranslations("projects");
	const [open, setOpen] = useState(false);
	const { data: magicLinks, isLoading } = api.project.listMagicLinks.useQuery(
		{ projectId },
	);

	const linksByRole = useMemo(() => {
		const map: Partial<Record<MagicLinkRole, NonNullable<typeof magicLinks>[number]>> = {};
		for (const link of magicLinks ?? []) {
			if (link.roleGranted === "EDITOR" || link.roleGranted === "CONTRIBUTOR" || link.roleGranted === "VIEWER") {
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
		<Collapsible className="border-y border-border/60" onOpenChange={setOpen} open={open}>
			<CollapsibleTrigger asChild>
				<button
					className="flex h-auto w-full cursor-pointer items-center gap-3 rounded-none px-6 py-4 text-left transition-colors hover:bg-muted/50"
					type="button"
				>
					<div className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
						activeCount > 0
							? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
							: "bg-muted text-muted-foreground",
					)}>
						<Link2 className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="font-medium text-sm">{t("inviteLinks")}</p>
						<p className="text-muted-foreground text-xs">
							{activeCount > 0
								? t("activeLinks", { count: activeCount })
								: t("createLinksToShare")
							}
						</p>
					</div>
					<ChevronRight className={cn(
						"h-4 w-4 text-muted-foreground transition-transform",
						open && "rotate-90",
					)} />
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
	link: {
		id: string;
		roleGranted: string;
		useCount: number;
		createdAt: Date | string;
		isActive: boolean;
	} | undefined;
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
	const linkUrl = link ? `${baseUrl}/projects/${projectId}?invite=${link.id}` : null;

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
						<p className="font-medium text-sm">{t(ROLE_LABEL_KEYS[role] ?? "roleContributor")}</p>
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
							<span className="font-medium text-sm">{t(ROLE_LABEL_KEYS[role] ?? "roleContributor")}</span>
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
											<Button
												className="h-7 w-7"
												size="icon"
												variant="ghost"
											>
												<QrCode className="h-3.5 w-3.5" />
											</Button>
										</PopoverTrigger>
									</TooltipTrigger>
									<TooltipContent>{t("qrCode")}</TooltipContent>
								</Tooltip>
								<PopoverContent align="end" className="w-auto p-4">
									<div className="flex flex-col items-center gap-3">
										<div className="rounded-lg bg-white p-3">
											<QRCodeSVG
												level="M"
												size={160}
												value={linkUrl ?? ""}
											/>
										</div>
										<p className="text-center text-muted-foreground text-xs">
											{t("scanToJoinAs", { role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor") })}
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
							<AlertDialogTitle>{t("generateNewRoleLink", { role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor") })}</AlertDialogTitle>
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
							<AlertDialogTitle>{t("revokeRoleLink", { role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor") })}</AlertDialogTitle>
							<AlertDialogDescription>
								{t("revokeLinkDescription", { role: t(ROLE_LABEL_KEYS[role] ?? "roleContributor") })}
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
