"use client";

import { Ghost, Search, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "~/components/ui/popover";
import {
	type RebalanceParticipant,
	useRebalanceOnAdd,
} from "~/hooks/use-rebalance-on-add";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

// ── Add People Search ────────────────────────────────────────────────────────
//
// Search @user/email, select a real user, or create a ghost inline. Extracted
// from share-project-dialog.tsx so both the Share dialog and the People tab can
// reuse the exact same search + ghost-create + addParticipant + rebalance flow.
//
// - variant "search" (default): the full search box (Share dialog).
// - variant "ghost": the inline new-contact form directly (People tab
//   "Add a name" chooser), skipping the search box.
export function AddPeopleSearch({
	projectId,
	variant = "search",
	autoFocus = true,
	onAdded,
	promptRebalance: externalPromptRebalance,
}: {
	projectId: string;
	variant?: "search" | "ghost";
	autoFocus?: boolean;
	/** Fired after a participant is successfully added (e.g. to invalidate balances). */
	onAdded?: () => void;
	/**
	 * When this component lives inside a container that unmounts on add (a
	 * popover/dialog that closes after the add), the internal rebalance dialog
	 * would be torn down before it can appear. Callers in that situation own a
	 * stable `useRebalanceOnAdd` instance and pass its `promptRebalance` in; the
	 * dialog element is then rendered by the caller at a level that survives the
	 * close.
	 */
	promptRebalance?: (participant: RebalanceParticipant) => void;
}) {
	const t = useTranslations("projects");
	const [search, setSearch] = useState("");
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [showNewContact, setShowNewContact] = useState(variant === "ghost");
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const utils = api.useUtils();
	// After adding someone, offer to fold them into existing project expenses.
	// If the caller supplied a stable prompt (because this component unmounts on
	// add), use it and skip rendering our own dialog; otherwise own it locally.
	const internalRebalance = useRebalanceOnAdd(projectId);
	const promptRebalance = externalPromptRebalance ?? internalRebalance.promptRebalance;
	const rebalanceElement = externalPromptRebalance
		? null
		: internalRebalance.rebalanceElement;

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
				(r) => !existingKeys.has(`${r.participantType}:${r.participantId}`),
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
			onAdded?.();
			setSearch("");
			setPopoverOpen(false);
			// Fold the newcomer into eligible past expenses (organizer/editor only).
			promptRebalance(participant);
		},
		[projectId, addMutation, utils, t, promptRebalance, onAdded],
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
			if (variant !== "ghost") setShowNewContact(false);
			await addParticipant({
				participantType: result.participantType,
				participantId: result.participantId,
				name: result.name,
			});
		} catch {
			toast.error(t("failedToCreateContact"));
		}
	}, [newName, newEmail, createShadowMutation, addParticipant, t, variant]);

	const isEmailLike = searchQuery.includes("@") && searchQuery.includes(".");
	const noExactMatch =
		searchQuery.length >= 1 &&
		!isFetching &&
		filteredResults.length === 0 &&
		alreadyInProject.length === 0;

	// ── Ghost-only variant: render just the inline new-contact form ──
	if (variant === "ghost") {
		return (
			<>
				<div className="space-y-2">
					<Input
						autoFocus={autoFocus}
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
					<Button
						className="w-full gap-2"
						disabled={!newName.trim() || createShadowMutation.isPending}
						onClick={handleCreateShadow}
						type="button"
					>
						<Ghost className="h-4 w-4" />
						{createShadowMutation.isPending ? t("adding") : t("add")}
					</Button>
				</div>
				{rebalanceElement}
			</>
		);
	}

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
												<span className="text-muted-foreground text-xs">
													@{r.username}
												</span>
											) : "email" in r && r.email ? (
												<span className="text-muted-foreground text-xs">
													{r.email}
												</span>
											) : null}
										</div>
										<Badge className="ml-auto text-[10px]" variant="outline">
											{r.participantType === "user"
												? t("user")
												: t("contact")}
										</Badge>
									</Button>
								))}
							</div>
						)}

						{/* Already in project */}
						{alreadyInProject.length > 0 && filteredResults.length === 0 && (
							<div className="p-3 text-center text-muted-foreground text-sm">
								{t("personAlreadyInProject", {
									name: alreadyInProject[0]?.name ?? "",
								})}
							</div>
						)}

						{/* No match: email case */}
						{noExactMatch && isEmailLike && !showNewContact && (
							<div className="space-y-1 p-3">
								<p className="text-muted-foreground text-sm">
									{t("noAccountFoundFor")}{" "}
									<span className="font-medium text-foreground">{search}</span>
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
										disabled={!newName.trim() || createShadowMutation.isPending}
										onClick={handleCreateShadow}
										size="sm"
										type="button"
									>
										{createShadowMutation.isPending ? t("adding") : t("add")}
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
