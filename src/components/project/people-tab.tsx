"use client";

import {
	ChevronDown,
	Crown,
	Ghost,
	Link2,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { TransferOwnershipDialog } from "~/components/project/transfer-ownership-dialog";
import { AddPeopleSearch } from "~/components/project/add-people-search";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
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
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
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
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

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

interface PeopleTabProps {
	projectId: string;
	projectName: string;
	createdById: string;
	participants: Participant[];
	primaryCurrency: string;
	isOrganizer: boolean;
	isEditor: boolean;
	currentUserId: string | undefined;
}

const ROLE_ORDER: Record<string, number> = {
	ORGANIZER: 0,
	EDITOR: 1,
	CONTRIBUTOR: 2,
	VIEWER: 3,
};

const ROLE_COLORS: Record<string, string> = {
	ORGANIZER: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	EDITOR: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	CONTRIBUTOR: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
	VIEWER: "bg-muted/30 text-muted-foreground",
};

const ROLE_LABEL_KEYS: Record<string, string> = {
	ORGANIZER: "roleOwner",
	EDITOR: "roleEditor",
	CONTRIBUTOR: "roleContributor",
	VIEWER: "roleViewer",
};

// ── Component ────────────────────────────────────────────────────────────────

export function PeopleTab({
	projectId,
	projectName,
	createdById,
	participants,
	primaryCurrency,
	isOrganizer,
	isEditor,
	currentUserId,
}: PeopleTabProps) {
	const t = useTranslations("projects");
	const utils = api.useUtils();
	const { formatCurrency } = useCurrencyFormatter();

	const isMultiPerson = participants.length > 1;

	// Paid + net balance both come from existing project-scoped endpoints — no
	// new balance query. "Paid" = participantBalances.totalPaid; the directed
	// "owes you / you owe" figure is read from the settlement plan (same source
	// participants-panel already uses).
	const { data: balancesData } = api.project.participantBalances.useQuery(
		{ projectId },
		{ enabled: isMultiPerson },
	);
	const { data: settlementPlan } = api.project.settlementPlan.useQuery(
		{ projectId },
		{ enabled: isMultiPerson },
	);

	// totalPaid per participant, restricted to the project's primary currency
	// (v1: no cross-currency summing — see plan risk note #1).
	const paidByParticipant = useMemo(() => {
		const map = new Map<string, number>();
		for (const b of balancesData?.balances ?? []) {
			if (b.currency !== primaryCurrency) continue;
			map.set(
				`${b.participant.participantType}:${b.participant.participantId}`,
				b.totalPaid,
			);
		}
		return map;
	}, [balancesData, primaryCurrency]);

	// Directed balance vs the current user, from settlement steps in the primary
	// currency. Positive → they owe you; negative → you owe them.
	const netVsMe = useMemo(() => {
		const map = new Map<string, number>();
		if (!settlementPlan || !currentUserId) return map;
		const breakdown = settlementPlan.byCurrency[primaryCurrency];
		if (!breakdown) return map;
		for (const step of breakdown.plan) {
			const fromMe =
				step.from.participantType === "user" &&
				step.from.participantId === currentUserId;
			const toMe =
				step.to.participantType === "user" &&
				step.to.participantId === currentUserId;
			if (fromMe) {
				// I pay `to` → I owe them.
				const key = `${step.to.participantType}:${step.to.participantId}`;
				map.set(key, (map.get(key) ?? 0) - step.amount);
			} else if (toMe) {
				// `from` pays me → they owe me.
				const key = `${step.from.participantType}:${step.from.participantId}`;
				map.set(key, (map.get(key) ?? 0) + step.amount);
			}
		}
		return map;
	}, [settlementPlan, currentUserId, primaryCurrency]);

	const isCreator = useCallback(
		(p: Participant) =>
			p.participantType === "user" && p.participantId === createdById,
		[createdById],
	);
	const isCurrentUser = useCallback(
		(p: Participant) =>
			p.participantType === "user" && p.participantId === currentUserId,
		[currentUserId],
	);

	const sorted = useMemo(() => {
		return [...participants].sort((a, b) => {
			const aOwner = isCreator(a) ? -1 : 0;
			const bOwner = isCreator(b) ? -1 : 0;
			if (aOwner !== bOwner) return aOwner - bOwner;
			const aMe = isCurrentUser(a) ? -1 : 0;
			const bMe = isCurrentUser(b) ? -1 : 0;
			if (aMe !== bMe) return aMe - bMe;
			const aRole = ROLE_ORDER[a.role] ?? 99;
			const bRole = ROLE_ORDER[b.role] ?? 99;
			if (aRole !== bRole) return aRole - bRole;
			return a.name.localeCompare(b.name);
		});
	}, [participants, isCurrentUser, isCreator]);

	const invalidateAll = useCallback(() => {
		void utils.project.detail.invalidate({ id: projectId });
		void utils.project.participantBalances.invalidate({ projectId });
		void utils.project.settlementPlan.invalidate({ projectId });
	}, [utils, projectId]);

	// ── Mutations ──────────────────────────────────────────────────────────────

	const updateRoleMutation = api.project.updateParticipantRole.useMutation({
		onSuccess: () => {
			toast.success(t("roleUpdated"));
			invalidateAll();
		},
		onError: (e) => toast.error(e.message),
	});

	const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
	const removeMutation = api.project.removeParticipant.useMutation({
		onSuccess: () => {
			toast.success(t("participantRemoved"));
			invalidateAll();
			setRemoveTarget(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const [transferTarget, setTransferTarget] = useState<Participant | null>(null);
	const transferMutation = api.project.transferOwnership.useMutation({
		onSuccess: () => {
			toast.success(t("ownershipTransferred"));
			invalidateAll();
			setTransferTarget(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const claimLinkMutation = api.claim.generateLink.useMutation({
		onSuccess: async (res) => {
			try {
				await navigator.clipboard.writeText(res.url);
				toast.success(t("claimLinkCopied", { name: res.name }));
			} catch {
				toast.success(res.url);
			}
		},
		onError: (e) => toast.error(e.message),
	});

	const [renameTarget, setRenameTarget] = useState<Participant | null>(null);

	const isOwner = currentUserId === createdById;

	return (
		<div className="space-y-3">
			{isEditor && (
				<div className="flex justify-end">
					<AddPersonChooser projectId={projectId} onAdded={invalidateAll} />
				</div>
			)}

			{/* Roster floats on the project background (no card) like Expenses. */}
			<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-border border-y text-muted-foreground text-xs">
								<th className="px-4 py-2 text-left font-medium sm:px-6">
									{t("person")}
								</th>
								<th className="px-4 py-2 text-left font-medium">{t("role")}</th>
								<th className="px-4 py-2 text-right font-medium">
									{t("paidColumn")}
								</th>
								<th className="px-4 py-2 text-right font-medium">
									{t("balanceColumn")}
								</th>
								<th className="w-11 px-2 py-2" />
							</tr>
						</thead>
						<tbody>
							{sorted.map((p) => {
								const key = `${p.participantType}:${p.participantId}`;
								const paid = paidByParticipant.get(key) ?? 0;
								const net = netVsMe.get(key);
								const me = isCurrentUser(p);
								return (
									<tr
										className="border-border/60 border-b last:border-0"
										key={p.id}
									>
										{/* Person */}
										<td className="px-4 py-3 sm:px-6">
											<div className="flex items-center gap-3">
												<PersonAvatar participant={p} />
												<div className="flex min-w-0 flex-col leading-tight">
													<span className="truncate font-medium">
														{p.name}
														{me && (
															<span className="ml-1 font-normal text-muted-foreground">
																({t("you")})
															</span>
														)}
													</span>
													<PersonSubline participant={p} />
												</div>
											</div>
										</td>

										{/* Role */}
										<td className="px-4 py-3">
											<RoleCell
												isCreator={isCreator(p)}
												isOrganizer={isOrganizer}
												isOwner={isOwner}
												onTransfer={() => setTransferTarget(p)}
												onUpdateRole={(role) =>
													updateRoleMutation.mutate({
														projectId,
														participantType: p.participantType as
															| "user"
															| "guest"
															| "shadow",
														participantId: p.participantId,
														role,
													})
												}
												participant={p}
											/>
										</td>

										{/* Paid */}
										<td className="px-4 py-3 text-right tabular-nums">
											{isMultiPerson
												? formatCurrency(paid, primaryCurrency)
												: formatCurrency(paid, primaryCurrency)}
										</td>

										{/* Balance */}
										<td className="px-4 py-3 text-right tabular-nums">
											<BalanceCell
												formatCurrency={formatCurrency}
												isMe={me}
												isMultiPerson={isMultiPerson}
												net={net}
												primaryCurrency={primaryCurrency}
											/>
										</td>

										{/* Row menu */}
										<td className="px-2 py-3 text-right">
											<RowMenu
												canManage={isOrganizer}
												isEditor={isEditor}
												isSelf={me || isCreator(p)}
												onCopyClaimLink={() =>
													claimLinkMutation.mutate({
														shadowId: p.participantId,
													})
												}
												onRemove={() => setRemoveTarget(p)}
												onRename={() => setRenameTarget(p)}
												participant={p}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

			{/* Remove confirmation */}
			<AlertDialog
				open={!!removeTarget}
				onOpenChange={(open) => {
					if (!open) setRemoveTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("removeFromProject", { name: removeTarget?.name ?? "" })}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("existingExpensesRemain")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeMutation.isPending}>
							{t("cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							className={buttonVariants({ variant: "destructive" })}
							disabled={removeMutation.isPending}
							onClick={(e) => {
								e.preventDefault();
								if (!removeTarget) return;
								removeMutation.mutate({
									projectId,
									participantType: removeTarget.participantType as
										| "user"
										| "guest"
										| "shadow",
									participantId: removeTarget.participantId,
								});
							}}
						>
							{removeMutation.isPending ? t("removing") : t("remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Transfer ownership */}
			<TransferOwnershipDialog
				isPending={transferMutation.isPending}
				onConfirm={() => {
					if (!transferTarget) return;
					transferMutation.mutate({
						projectId,
						newOwnerParticipantId: transferTarget.participantId,
						confirmProjectName: projectName,
					});
				}}
				onOpenChange={(open) => {
					if (!open) setTransferTarget(null);
				}}
				open={!!transferTarget}
				participantName={transferTarget?.name ?? ""}
				projectName={projectName}
			/>

			{/* Rename ghost */}
			<RenameShadowDialog
				onClose={() => setRenameTarget(null)}
				onRenamed={invalidateAll}
				shadow={renameTarget}
			/>
		</div>
	);
}

// ── Add-person chooser ───────────────────────────────────────────────────────

function AddPersonChooser({
	projectId,
	onAdded,
}: {
	projectId: string;
	onAdded: () => void;
}) {
	const t = useTranslations("projects");
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"chooser" | "invite" | "ghost">("chooser");

	const reset = () => setMode("chooser");

	return (
		<Popover
			onOpenChange={(o) => {
				setOpen(o);
				if (!o) reset();
			}}
			open={open}
		>
			<PopoverTrigger asChild>
				<Button size="sm">
					<Plus className="mr-1 h-4 w-4" />
					{t("addPerson")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-1.5">
				{mode === "chooser" && (
					<div className="flex flex-col gap-0.5">
						<p className="px-2.5 pt-1.5 pb-1 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">
							{t("addPersonChooserTitle")}
						</p>
						<ChooserOption
							description={t("inviteSomeoneDesc")}
							icon={<UserPlus className="h-4 w-4 text-primary" />}
							onClick={() => setMode("invite")}
							primary
							title={t("inviteSomeone")}
						/>
						<ChooserOption
							description={t("addANameDesc")}
							icon={<Ghost className="h-4 w-4" />}
							onClick={() => setMode("ghost")}
							title={t("addAName")}
						/>
					</div>
				)}
				{mode === "invite" && (
					<div className="p-1.5">
						<AddPeopleSearch
							onAdded={() => {
								onAdded();
								setOpen(false);
							}}
							projectId={projectId}
							variant="search"
						/>
					</div>
				)}
				{mode === "ghost" && (
					<div className="p-1.5">
						<AddPeopleSearch
							onAdded={() => {
								onAdded();
								setOpen(false);
							}}
							projectId={projectId}
							variant="ghost"
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function ChooserOption({
	icon,
	title,
	description,
	onClick,
	primary,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
	primary?: boolean;
}) {
	return (
		<button
			className="flex items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-accent"
			onClick={onClick}
			type="button"
		>
			<div
				className={cn(
					"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
					primary
						? "border-primary/35 bg-primary/15"
						: "border-border bg-muted",
				)}
			>
				{icon}
			</div>
			<div className="min-w-0">
				<div className="font-medium text-sm">{title}</div>
				<div className="text-muted-foreground text-xs">{description}</div>
			</div>
		</button>
	);
}

// ── Row pieces ───────────────────────────────────────────────────────────────

function PersonAvatar({ participant }: { participant: Participant }) {
	const p = participant;
	if (p.participantType === "shadow") {
		return (
			<div className="relative">
				<UserAvatar name={p.name} size="sm" />
				<Link2 className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full bg-background text-muted-foreground" />
			</div>
		);
	}
	return <UserAvatar avatarUrl={p.avatarUrl} name={p.name} size="sm" />;
}

function PersonSubline({ participant }: { participant: Participant }) {
	const t = useTranslations("projects");
	const p = participant;
	if (p.participantType === "shadow") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{p.email ?? t("shadowProfileNoAccount")}
			</span>
		);
	}
	if (p.participantType === "guest") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{p.email ? `${p.email} · ` : ""}
				{t("guestViaInviteLink")}
			</span>
		);
	}
	if (p.username) {
		return (
			<span className="truncate text-muted-foreground text-xs">
				@{p.username}
			</span>
		);
	}
	return null;
}

function RoleCell({
	participant,
	isCreator,
	isOrganizer,
	isOwner,
	onUpdateRole,
	onTransfer,
}: {
	participant: Participant;
	isCreator: boolean;
	isOrganizer: boolean;
	isOwner: boolean;
	onUpdateRole: (role: "EDITOR" | "CONTRIBUTOR" | "VIEWER") => void;
	onTransfer: () => void;
}) {
	const t = useTranslations("projects");
	const p = participant;

	// Creator is always shown as Owner.
	if (isCreator) {
		return (
			<Badge
				className={cn("gap-1 text-[10px]", ROLE_COLORS.ORGANIZER)}
				variant="outline"
			>
				<Crown className="h-3 w-3" />
				{t("roleOwner")}
			</Badge>
		);
	}

	// Ghosts can't hold roles beyond CONTRIBUTOR (server-capped) — show a badge.
	if (p.participantType === "shadow") {
		return (
			<Badge className="gap-1 text-[10px]" variant="outline">
				<Ghost className="h-3 w-3" />
				{t("ghostBadge")}
			</Badge>
		);
	}

	// Organizer can change roles via the dropdown; others see a read-only badge.
	if (isOrganizer) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						className="h-auto gap-1 px-2 py-1 text-xs"
						size="sm"
						variant="ghost"
					>
						{t(ROLE_LABEL_KEYS[p.role] ?? "roleContributor")}
						<ChevronDown className="h-3 w-3 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuRadioGroup
						onValueChange={(role) =>
							onUpdateRole(role as "EDITOR" | "CONTRIBUTOR" | "VIEWER")
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
					{isOwner && p.participantType === "user" && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onTransfer}>
								{t("transferOwnership")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return (
		<Badge
			className={cn("text-[10px]", ROLE_COLORS[p.role] ?? "")}
			variant="outline"
		>
			{t(ROLE_LABEL_KEYS[p.role] ?? "roleContributor")}
		</Badge>
	);
}

function BalanceCell({
	isMe,
	isMultiPerson,
	net,
	primaryCurrency,
	formatCurrency,
}: {
	isMe: boolean;
	isMultiPerson: boolean;
	net: number | undefined;
	primaryCurrency: string;
	formatCurrency: (amount: number, currency: string) => string;
}) {
	const t = useTranslations("projects");
	if (isMe || !isMultiPerson) {
		return null;
	}
	if (net === undefined || Math.abs(net) < 0.005) {
		return null;
	}
	if (net > 0) {
		return (
			<span className="text-emerald-600 dark:text-emerald-400">
				{t("owesYou", { amount: formatCurrency(net, primaryCurrency) })}
			</span>
		);
	}
	return (
		<span className="text-amber-600 dark:text-amber-400">
			{t("youOwe", { amount: formatCurrency(-net, primaryCurrency) })}
		</span>
	);
}

function RowMenu({
	participant,
	isSelf,
	canManage,
	isEditor,
	onRename,
	onCopyClaimLink,
	onRemove,
}: {
	participant: Participant;
	isSelf: boolean;
	canManage: boolean;
	isEditor: boolean;
	onRename: () => void;
	onCopyClaimLink: () => void;
	onRemove: () => void;
}) {
	const t = useTranslations("projects");
	const p = participant;
	const isShadow = p.participantType === "shadow";

	// Nothing actionable for the creator's own row.
	const canRename = isShadow && isEditor;
	const canCopyClaim = isShadow && isEditor;
	const canRemove = canManage && !isSelf;

	if (!canRename && !canCopyClaim && !canRemove) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className="h-7 w-7 text-muted-foreground" size="icon" variant="ghost">
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				{canRename && (
					<DropdownMenuItem onClick={onRename}>
						<Pencil className="mr-2 h-4 w-4" />
						{t("rename")}
					</DropdownMenuItem>
				)}
				{canCopyClaim && (
					<DropdownMenuItem onClick={onCopyClaimLink}>
						<Link2 className="mr-2 h-4 w-4" />
						{t("copyClaimLink")}
					</DropdownMenuItem>
				)}
				{canRemove && (canRename || canCopyClaim) && <DropdownMenuSeparator />}
				{canRemove && (
					<DropdownMenuItem onClick={onRemove} variant="destructive">
						<Trash2 className="mr-2 h-4 w-4" />
						{t("remove")}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ── Rename ghost dialog ──────────────────────────────────────────────────────

function RenameShadowDialog({
	shadow,
	onClose,
	onRenamed,
}: {
	shadow: Participant | null;
	onClose: () => void;
	onRenamed: () => void;
}) {
	const t = useTranslations("projects");
	const [name, setName] = useState("");

	const renameMutation = api.people.updateShadow.useMutation({
		onSuccess: () => {
			toast.success(t("renamed"));
			onRenamed();
			onClose();
		},
		onError: () => toast.error(t("renameFailed")),
	});

	// Seed the input with the current name whenever a new target opens.
	const open = shadow !== null;
	const currentName = shadow?.name ?? "";

	return (
		<Dialog
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
			open={open}
		>
			<DialogContent
				className="sm:max-w-sm"
				onOpenAutoFocus={() => setName(currentName)}
			>
				<DialogHeader>
					<DialogTitle>{t("renamePerson")}</DialogTitle>
				</DialogHeader>
				<Input
					onChange={(e) => setName(e.target.value)}
					placeholder={t("renamePlaceholder")}
					value={name}
				/>
				<DialogFooter>
					<Button onClick={onClose} variant="ghost">
						{t("cancel")}
					</Button>
					<Button
						disabled={!name.trim() || renameMutation.isPending}
						onClick={() => {
							if (!shadow || !name.trim()) return;
							renameMutation.mutate({
								shadowId: shadow.participantId,
								name: name.trim(),
							});
						}}
					>
						{renameMutation.isPending ? t("adding") : t("rename")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
