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

const ROLE_LABELS: Record<string, string> = {
	ORGANIZER: "Organizer",
	EDITOR: "Editor",
	CONTRIBUTOR: "Contributor",
	VIEWER: "Viewer",
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
	const { data: session } = useSession();
	const userId = session?.user?.id;

	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent
				className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg [&>button]:right-6 [&>button]:top-6"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<ResponsiveDialogHeader className="px-6 pt-6 pb-4">
					<ResponsiveDialogTitle>Share &ldquo;{projectName}&rdquo;</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						Manage who has access to this project.
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
						userId={userId}
					/>
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

// ── Add People Search ────────────────────────────────────────────────────────

function AddPeopleSearch({ projectId }: { projectId: string }) {
	const [search, setSearch] = useState("");
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [showNewContact, setShowNewContact] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const utils = api.useUtils();

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

	const addMutation = api.project.addParticipant.useMutation({
		onSuccess: () => {
			toast.success("Participant added");
			void utils.project.detail.invalidate({ id: projectId });
			setSearch("");
			setPopoverOpen(false);
		},
		onError: (e) => {
			if (e.message.includes("already in the project")) {
				toast.info("Already in project");
			} else {
				toast.error(e.message);
			}
		},
	});

	const createShadowMutation = api.people.createShadow.useMutation();

	const handleSelect = useCallback(
		(participant: { participantType: string; participantId: string }) => {
			if (
				existingKeys.has(
					`${participant.participantType}:${participant.participantId}`,
				)
			) {
				toast.info("Already in project");
				return;
			}
			addMutation.mutate({
				projectId,
				participantType: participant.participantType as
					| "user"
					| "guest"
					| "shadow",
				participantId: participant.participantId,
				role: "CONTRIBUTOR",
			});
		},
		[projectId, existingKeys, addMutation],
	);

	const handleCreateShadow = useCallback(async () => {
		if (!newName.trim()) return;
		try {
			const result = await createShadowMutation.mutateAsync({
				name: newName.trim(),
				email: newEmail.trim() || undefined,
			});
			addMutation.mutate({
				projectId,
				participantType: "shadow",
				participantId: result.participantId,
				role: "CONTRIBUTOR",
			});
			setNewName("");
			setNewEmail("");
			setShowNewContact(false);
		} catch {
			toast.error("Failed to create contact");
		}
	}, [newName, newEmail, createShadowMutation, addMutation, projectId]);

	const isEmailLike = searchQuery.includes("@") && searchQuery.includes(".");
	const noExactMatch =
		searchQuery.length >= 1 &&
		!isFetching &&
		filteredResults.length === 0 &&
		alreadyInProject.length === 0;

	return (
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
						placeholder="Add people by name or email..."
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
											? "User"
											: "Contact"}
									</Badge>
								</Button>
							))}
						</div>
					)}

					{/* Already in project */}
					{alreadyInProject.length > 0 &&
						filteredResults.length === 0 && (
							<div className="p-3 text-center text-muted-foreground text-sm">
								{alreadyInProject[0]?.name} is already in this
								project
							</div>
						)}

					{/* No match: email case */}
					{noExactMatch && isEmailLike && !showNewContact && (
						<div className="space-y-1 p-3">
							<p className="text-muted-foreground text-sm">
								No account found for{" "}
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
								Add as shadow profile
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
								Add &ldquo;{search}&rdquo; as new contact
							</Button>
						</div>
					)}

					{/* Inline new contact form */}
					{showNewContact && (
						<div className="space-y-2 p-3">
							<p className="font-medium text-sm">New contact</p>
							<Input
								autoFocus
								onChange={(e) => setNewName(e.target.value)}
								placeholder="Name"
								value={newName}
							/>
							<Input
								onChange={(e) => setNewEmail(e.target.value)}
								placeholder="Email (optional)"
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
									Cancel
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
										? "Adding..."
										: "Add"}
								</Button>
							</div>
						</div>
					)}

					{/* Loading */}
					{isFetching && filteredResults.length === 0 && (
						<div className="p-4 text-center text-muted-foreground text-sm">
							Searching...
						</div>
					)}

					{/* Empty search */}
					{search.length === 0 && (
						<div className="p-4 text-center text-muted-foreground text-sm">
							Type a name or email to search
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

// ── Participant List ─────────────────────────────────────────────────────────

function ParticipantList({
	projectId,
	createdById,
	isOrganizer,
	isEditor,
	userId,
}: {
	projectId: string;
	createdById: string;
	isOrganizer: boolean;
	isEditor: boolean;
	userId: string | undefined;
}) {
	const { data: project } = api.project.detail.useQuery({ id: projectId });
	const participants = project?.participants ?? [];
	const utils = api.useUtils();

	const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);

	const updateRoleMutation = api.project.updateParticipantRole.useMutation({
		onSuccess: () => {
			toast.success("Role updated");
			void utils.project.detail.invalidate({ id: projectId });
		},
		onError: (e) => toast.error(e.message),
	});

	const removeMutation = api.project.removeParticipant.useMutation({
		onSuccess: () => {
			toast.success("Participant removed");
			void utils.project.detail.invalidate({ id: projectId });
			setRemoveTarget(null);
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
			// Current user first
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
	}, [participants, isCurrentUser]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="px-6 pt-3 pb-2">
				<p className="font-medium tabular-nums text-muted-foreground text-xs">
					{participants.length} {participants.length === 1 ? "person" : "people"} with access
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
											(you)
										</span>
									)}
								</div>
								<ParticipantStatusLine participant={p} />
							</div>

							{/* Role control */}
							{isCreator(p) ? (
								<span className="shrink-0 px-2 py-1 text-muted-foreground text-xs">
									Organizer
								</span>
							) : isOrganizer ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											className="h-auto shrink-0 gap-1 px-2 py-1 text-xs"
											variant="ghost"
											size="sm"
										>
											{ROLE_LABELS[p.role] ?? p.role}
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
												Editor
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="CONTRIBUTOR">
												Contributor
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="VIEWER">
												Viewer
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											onClick={() => setRemoveTarget(p)}
											variant="destructive"
										>
											Remove access
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<Badge
									className="text-[10px]"
									variant="outline"
								>
									{ROLE_LABELS[p.role] ?? p.role}
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
	const p = participant;
	if (p.participantType === "shadow") {
		return (
			<p className="truncate text-muted-foreground text-xs">
				{p.email ?? "Shadow profile \u00b7 No account yet"}
			</p>
		);
	}
	if (p.participantType === "guest") {
		return (
			<p className="truncate text-muted-foreground text-xs">
				{p.email ? `${p.email} \u00b7 ` : ""}Guest (via invite link)
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
	return (
		<div className="border-border border-t bg-destructive/5 px-6 py-3">
			<p className="font-medium text-sm">
				Remove {participantName} from this project?
			</p>
			<p className="mt-0.5 text-muted-foreground text-xs">
				Their existing expenses will remain in the project.
			</p>
			<div className="mt-2 flex justify-end gap-2">
				<Button onClick={onCancel} size="sm" variant="ghost">
					Cancel
				</Button>
				<Button
					disabled={isPending}
					onClick={onConfirm}
					size="sm"
					variant="destructive"
				>
					{isPending ? "Removing..." : "Remove"}
				</Button>
			</div>
		</div>
	);
}

// ── Link Access ──────────────────────────────────────────────────────────────

const VISIBILITY_DESCRIPTIONS: Record<string, string> = {
	PRIVATE: "Only participants can access",
	PUBLIC: "Anyone with the link can view",
};

function LinkAccessSection({
	projectId,
	isOrganizer,
}: {
	projectId: string;
	isOrganizer: boolean;
}) {
	const utils = api.useUtils();
	const { data: project } = api.project.detail.useQuery({ id: projectId });
	const [copied, setCopied] = useState(false);

	const updateMutation = api.project.update.useMutation({
		onSuccess: () => {
			toast.success("Visibility updated");
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
						{isPublic ? "Public" : "Private"}
					</p>
					<p className="text-muted-foreground text-xs">
						{VISIBILITY_DESCRIPTIONS[visibility]}
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
							{copied ? "Copied!" : "Copy link"}
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
						<p className="font-medium text-sm">Invite links</p>
						<p className="text-muted-foreground text-xs">
							{activeCount > 0
								? `${activeCount} active ${activeCount === 1 ? "link" : "links"}`
								: "Create links to share with others"
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
						<p className="font-medium text-sm">{ROLE_LABELS[role]}</p>
						<p className="text-muted-foreground text-xs">Not created</p>
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
						{createMutation.isPending ? "Creating..." : "Create"}
					</Button>
				</div>
			) : (
				<>
				<div className="flex items-center gap-2">
					{/* Left: role info */}
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="flex items-center gap-2">
							<span className="font-medium text-sm">{ROLE_LABELS[role]}</span>
							<Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
								Active
							</Badge>
						</div>
						{/* Meta + show link toggle */}
						<p className="text-muted-foreground text-xs">
							{link.useCount}{" "}
							{link.useCount === 1 ? "join" : "joins"} · Created{" "}
							{formatLinkDate(link.createdAt)} ·{" "}
							<Button
								className="h-auto p-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
								onClick={() => setShowLink((v) => !v)}
								type="button"
								variant="link"
							>
								{showLink ? "Hide link" : "Show link"}
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
									{copied ? "Copied!" : "Copy invite link"}
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
									<TooltipContent>QR code</TooltipContent>
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
											Scan to join as {ROLE_LABELS[role]}
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
								<TooltipContent>Generate new link</TooltipContent>
							</Tooltip>
							<Button
								className="h-7 px-2 text-xs text-destructive hover:text-destructive"
								onClick={() => setConfirmRevoke(true)}
								size="sm"
								variant="ghost"
							>
								Revoke
							</Button>
						</div>
					</div>
				{/* Reset confirmation dialog */}
				<AlertDialog onOpenChange={setConfirmReset} open={confirmReset}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Generate new {ROLE_LABELS[role]} link?</AlertDialogTitle>
							<AlertDialogDescription>
								The current link will stop working. Anyone who has it won&apos;t be able to join.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className={buttonVariants({ variant: "destructive" })}
								disabled={resetMutation.isPending}
								onClick={(e) => {
									e.preventDefault();
									resetMutation.mutate({ projectId, role });
								}}
							>
								{resetMutation.isPending ? "Generating..." : "Generate new link"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				{/* Revoke confirmation dialog */}
				<AlertDialog onOpenChange={setConfirmRevoke} open={confirmRevoke}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Revoke {ROLE_LABELS[role]} link?</AlertDialogTitle>
							<AlertDialogDescription>
								Anyone who has this link won&apos;t be able to join as {ROLE_LABELS[role]}.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
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
								{revokeMutation.isPending ? "Revoking..." : "Revoke"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				</>
			)}
		</div>
	);
}
