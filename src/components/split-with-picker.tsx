"use client";

import { Check, Search, UserPlus, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirmation-dialog";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "~/components/ui/popover";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";

export interface SplitParticipant {
	participantType: "user" | "shadow";
	participantId: string;
	name: string;
	email: string | null;
	username?: string | null;
	avatarUrl?: string | null;
}

interface SplitWithPickerProps {
	value: SplitParticipant[];
	onChange: (participants: SplitParticipant[]) => void;
	projectId?: string;
	currentUserId?: string;
}

export function SplitWithPicker({
	value,
	onChange,
	projectId,
	currentUserId,
}: SplitWithPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [expanded, setExpanded] = useState(false);
	const [showNewContact, setShowNewContact] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Confirm dialog state for adding non-members to a project
	const [pendingNonMember, setPendingNonMember] = useState<SplitParticipant | null>(null);

	const searchQuery = search.startsWith("@") ? search.slice(1) : search;

	const { data: searchResults, isFetching } = api.people.search.useQuery(
		{ query: searchQuery },
		{ enabled: searchQuery.length >= 1 },
	);

	// Frequent partners (only when not in a project context)
	const { data: frequentPartners } = api.people.frequentSplitPartners.useQuery(
		undefined,
		{ enabled: !projectId },
	);

	// Project participants (when in project context)
	const { data: projectDetail } = api.project.detail.useQuery(
		{ id: projectId ?? "" },
		{ enabled: !!projectId },
	);

	const createShadowMutation = api.people.createShadow.useMutation();
	const addParticipantMutation = api.project.addParticipant.useMutation();
	const utils = api.useUtils();

	const isOrganizer = projectDetail?.myRole === "ORGANIZER";

	const selectedKeys = useMemo(
		() => new Set(value.map((p) => `${p.participantType}:${p.participantId}`)),
		[value],
	);

	const allResults = useMemo(() => {
		if (!searchResults) return [];
		return [
			...searchResults.users.map((u) => ({ ...u, avatarUrl: u.avatarUrl })),
			...searchResults.shadows,
		];
	}, [searchResults]);

	const projectParticipantKeys = useMemo(() => {
		if (!projectId || !projectDetail) return null;
		return new Set(
			projectDetail.participants.map(
				(p) => `${p.participantType}:${p.participantId}`,
			),
		);
	}, [projectId, projectDetail]);

	const filteredResults = useMemo(() => {
		let results = allResults.filter(
			(r) => !selectedKeys.has(`${r.participantType}:${r.participantId}`),
		);
		// In project context: organizers see all results, non-organizers only see members
		if (projectParticipantKeys && !isOrganizer) {
			results = results.filter((r) =>
				projectParticipantKeys.has(`${r.participantType}:${r.participantId}`),
			);
		}
		return results;
	}, [allResults, selectedKeys, projectParticipantKeys, isOrganizer]);

	// Chip participants: project members or frequent partners
	const chipParticipants = useMemo((): SplitParticipant[] => {
		if (projectId && projectDetail) {
			return projectDetail.participants
				.filter(
					(p) =>
						(p.participantType === "user" || p.participantType === "shadow") &&
						!(p.participantType === "user" && p.participantId === currentUserId),
				)
				.map((p) => ({
					participantType: p.participantType as "user" | "shadow",
					participantId: p.participantId,
					name: p.name,
					email: p.email,
					username: p.username,
					avatarUrl: p.avatarUrl,
				}));
		}
		if (frequentPartners && frequentPartners.length > 0) {
			return frequentPartners.map((p) => ({
				participantType: p.participantType,
				participantId: p.participantId,
				name: p.name,
				email: p.email,
				username: p.username,
				avatarUrl: p.avatarUrl,
			}));
		}
		return [];
	}, [projectId, projectDetail, frequentPartners, currentUserId]);

	const handleSelect = useCallback(
		(participant: SplitParticipant) => {
			// In project context, check if participant is a non-member
			if (projectParticipantKeys && !projectParticipantKeys.has(`${participant.participantType}:${participant.participantId}`)) {
				setPendingNonMember(participant);
				return;
			}
			onChange([...value, participant]);
			setSearch("");
			setShowNewContact(false);
		},
		[value, onChange, projectParticipantKeys],
	);

	const handleConfirmAddToProject = useCallback(async () => {
		if (!pendingNonMember || !projectId) return;
		await addParticipantMutation.mutateAsync({
			projectId,
			participantType: pendingNonMember.participantType,
			participantId: pendingNonMember.participantId,
			role: "CONTRIBUTOR",
		});
		// Refresh project detail so the participant keys are up to date
		await utils.project.detail.invalidate({ id: projectId });
		onChange([...value, pendingNonMember]);
		setPendingNonMember(null);
		setSearch("");
		setShowNewContact(false);
	}, [pendingNonMember, projectId, addParticipantMutation, utils, onChange, value]);

	const handleRemove = useCallback(
		(participantId: string, participantType: string) => {
			onChange(
				value.filter(
					(p) =>
						!(
							p.participantId === participantId &&
							p.participantType === participantType
						),
				),
			);
		},
		[value, onChange],
	);

	const handleCreateShadow = useCallback(async () => {
		if (!newName.trim()) return;
		const result = await createShadowMutation.mutateAsync({
			name: newName.trim(),
			email: newEmail.trim() || undefined,
		});
		const participant: SplitParticipant = {
			participantType: result.participantType,
			participantId: result.participantId,
			name: result.name,
			email: result.email,
		};
		// In project context, this shadow is new - needs to be added to project
		if (projectId && projectParticipantKeys && !projectParticipantKeys.has(`${participant.participantType}:${participant.participantId}`)) {
			setPendingNonMember(participant);
		} else {
			handleSelect(participant);
		}
		setNewName("");
		setNewEmail("");
		setShowNewContact(false);
	}, [newName, newEmail, createShadowMutation, handleSelect, projectId, projectParticipantKeys]);

	// Whether to allow adding new contacts (non-project or organizer in project)
	const canAddNewContact = !projectId || isOrganizer;

	return (
		<div className="space-y-1.5">
			{/* Participant chips + inline search */}
			<div className="flex flex-wrap items-center gap-1.5">
				{chipParticipants.map((p) => {
					const key = `${p.participantType}:${p.participantId}`;
					const isSelected = selectedKeys.has(key);
					return (
						<Button
							key={key}
							type="button"
							onClick={() => {
								if (isSelected) {
									handleRemove(p.participantId, p.participantType);
								} else {
									handleSelect(p);
								}
							}}
							variant="outline"
							size="sm"
							className={cn(
								"h-auto gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
								isSelected
									? "border-primary/40 bg-primary/10 dark:bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
							)}
						>
							<UserAvatar
								name={p.name}
								avatarUrl={p.avatarUrl ?? undefined}
								size="xs"
							/>
							<span>{p.name.split(" ")[0]}</span>
							{isSelected && <Check className="h-3 w-3" />}
						</Button>
					);
				})}

				{/* Expandable search */}
				<Popover onOpenChange={setOpen} open={open}>
					<PopoverAnchor asChild>
						<div
							className={cn(
								"flex items-center overflow-hidden rounded-lg border transition-all duration-200 ease-in-out",
								(expanded || search.length > 0)
									? "w-48 border-input shadow-xs sm:w-64"
									: "w-9 border-transparent",
							)}
						>
							<Button
								className={cn(
									"h-9 w-9 shrink-0",
									(expanded || search.length > 0)
										? "pointer-events-none text-foreground hover:bg-transparent"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => {
									if (!expanded && !search) {
										setExpanded(true);
										setTimeout(() => searchInputRef.current?.focus(), 0);
									}
								}}
								type="button"
								variant="ghost"
								size="icon"
							>
								<Search className="h-4 w-4" />
							</Button>
							<input
								ref={searchInputRef}
								autoComplete="one-time-code"
								className={cn(
									"h-9 min-w-0 flex-1 bg-transparent pr-2 text-sm outline-none placeholder:text-muted-foreground",
									(expanded || search.length > 0) ? "opacity-100" : "pointer-events-none opacity-0",
								)}
								data-1p-ignore
								data-bwignore
								data-lpignore="true"
								onChange={(e) => {
									setSearch(e.target.value);
									setShowNewContact(false);
									if (!open && e.target.value.length > 0) setOpen(true);
								}}
								onFocus={() => {
									if (search.length > 0) setOpen(true);
								}}
								onBlur={() => {
									setTimeout(() => {
										if (!search) setExpanded(false);
									}, 200);
								}}
								onKeyDown={(e) => {
									if (e.key === 'Escape') {
										if (!search) setExpanded(false);
										return;
									}
									if (e.key !== 'Enter') return;
									if (filteredResults.length === 1 && filteredResults[0]) {
										const r = filteredResults[0];
										handleSelect({
											participantType: r.participantType,
											participantId: r.participantId,
											name: r.name,
											email: 'email' in r ? r.email : null,
											username: 'username' in r ? r.username : undefined,
											avatarUrl: 'avatarUrl' in r ? r.avatarUrl : undefined,
										});
									} else if (
										filteredResults.length === 0 &&
										searchQuery.length >= 1 &&
										!isFetching &&
										!showNewContact &&
										canAddNewContact
									) {
										setShowNewContact(true);
										setNewName(searchQuery);
									}
								}}
								aria-label="Search people"
								placeholder="Search people..."
								value={search}
							/>
							{(expanded || search.length > 0) && search && (
								<Button
									className="mr-2 h-auto w-auto shrink-0 p-0 text-muted-foreground hover:text-foreground"
									onClick={() => {
										setSearch("");
										searchInputRef.current?.focus();
									}}
									type="button"
									variant="ghost"
									size="icon"
								>
									<X className="h-4 w-4" />
								</Button>
							)}
						</div>
					</PopoverAnchor>
					<PopoverContent
						align="start"
						className="w-72 p-0"
						onOpenAutoFocus={(e) => e.preventDefault()}
					>
					<div
						className="max-h-64 overflow-y-auto overscroll-contain"
						onTouchMove={(e) => e.stopPropagation()}
						onWheel={(e) => e.stopPropagation()}
					>
						{/* Search results */}
						{filteredResults.length > 0 && (
							<div className="flex flex-col p-1">
								{filteredResults.map((r) => {
									const isMember = !projectParticipantKeys || projectParticipantKeys.has(`${r.participantType}:${r.participantId}`);
									return (
										<Button
											className="h-auto w-full justify-start gap-2 px-3 py-2"
											key={`${r.participantType}:${r.participantId}`}
											onClick={() =>
												handleSelect({
													participantType: r.participantType,
													participantId: r.participantId,
													name: r.name,
													email: "email" in r ? r.email : null,
													username: "username" in r ? r.username : undefined,
													avatarUrl: "avatarUrl" in r ? r.avatarUrl : undefined,
												})
											}
											type="button"
											variant="ghost"
										>
											<UserAvatar
												name={r.name}
												avatarUrl={"avatarUrl" in r ? r.avatarUrl : undefined}
												size="xs"
											/>
											<div className="flex flex-col items-start">
												<span className="text-sm">{r.name}</span>
												{r.participantType === "user" && r.username ? (
													<span className="text-muted-foreground text-xs">@{r.username}</span>
												) : r.participantType === "shadow" && r.email ? (
													<span className="text-muted-foreground text-xs">{r.email}</span>
												) : null}
											</div>
											{!isMember && (
												<span className="ml-auto text-muted-foreground text-xs">Not in project</span>
											)}
										</Button>
									);
								})}
							</div>
						)}

						{/* "Add new" prompt: shown when no results or after results */}
						{search.length >= 1 && !isFetching && !showNewContact && canAddNewContact && (
							<div
								className={filteredResults.length > 0 ? "border-t p-2" : "p-2"}
							>
								<Button
									className="w-full justify-start gap-2"
									onClick={() => {
										setShowNewContact(true);
										setNewName(searchQuery);
									}}
									type="button"
									variant="ghost"
								>
									<UserPlus className="h-4 w-4" />
									<span>Add &ldquo;{search}&rdquo; as non-Retrospend user</span>
								</Button>
							</div>
						)}

						{/* Inline new contact form */}
						{showNewContact && canAddNewContact && (
							<div className="space-y-2 p-3">
								<p className="font-medium text-sm">Add non-Retrospend user</p>
								<p className="text-muted-foreground text-xs">
									{projectId
										? "They\u2019ll be added as a contributor to this project."
										: "They\u2019ll appear in your contacts for future splits. If they join later, you can link their account."}
								</p>
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
										disabled={!newName.trim() || createShadowMutation.isPending}
										onClick={handleCreateShadow}
										size="sm"
										type="button"
									>
										{createShadowMutation.isPending ? "Adding..." : "Add"}
									</Button>
								</div>
							</div>
						)}

						{/* Loading state */}
						{isFetching && filteredResults.length === 0 && (
							<div className="p-4 text-center text-muted-foreground text-sm">
								Searching...
							</div>
						)}

						{/* Empty search */}
						{search.length === 0 && (
							<div className="p-4 text-center text-muted-foreground text-sm">
								Type a name to search
							</div>
						)}
					</div>
					</PopoverContent>
				</Popover>
			</div>

			{/* Confirm dialog for adding non-members to project */}
			<ConfirmDialog
				open={!!pendingNonMember}
				onOpenChange={(open) => { if (!open) setPendingNonMember(null); }}
				title="Add to project?"
				description={
					pendingNonMember
						? `${pendingNonMember.name} is not currently in this project. Would you like to add them as a contributor?`
						: undefined
				}
				confirmText="Add to project"
				onConfirm={handleConfirmAddToProject}
				isLoading={addParticipantMutation.isPending}
			/>
		</div>
	);
}
