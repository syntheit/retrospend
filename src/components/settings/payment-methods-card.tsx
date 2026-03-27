"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ArrowLeft,
	Check,
	Copy,
	ExternalLink,
	Gift,
	GripVertical,
	Link2,
	MoreHorizontal,
	Pencil,
	Plus,
	Search,
	Trash2,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CurrencyPicker } from "~/components/currency-picker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PaymentMethodIcon } from "~/components/ui/payment-method-icon";
import { UserAvatar } from "~/components/ui/user-avatar";
import { env } from "~/env";
import { useSession } from "~/hooks/use-session";
import { useUserSettings } from "~/hooks/use-user-settings";
import type { CurrencyCode } from "~/lib/currencies";
import {
	getCurrencyForType,
	getIdentifierConfig,
	getMethodsByRegion,
	getMethodType,
	getNetworksForType,
	type PaymentMethodTypeDef,
	resolveMethodTypeId,
} from "~/lib/payment-method-registry";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Visibility = "PUBLIC" | "FRIENDS_ONLY" | "PAYMENT_ONLY";

interface Method {
	id?: string;
	localId: string;
	type: string;
	label: string;
	identifier: string;
	visibility: Visibility;
	minAmount: string;
	currency: string;
	network: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _localIdCounter = 0;
function newLocalId() {
	return `local_${++_localIdCounter}`;
}

const VISIBILITY_CONFIG = [
	{
		value: "PUBLIC" as Visibility,
		label: "Public",
		activeClass: "text-emerald-600 dark:text-emerald-400",
	},
	{
		value: "FRIENDS_ONLY" as Visibility,
		label: "Contacts",
		activeClass: "text-blue-600 dark:text-blue-400",
	},
	{
		value: "PAYMENT_ONLY" as Visibility,
		label: "Settlement",
		activeClass: "text-muted-foreground",
	},
] as const;

const FEE_LEVEL_COLORS: Record<string, string> = {
	low: "text-emerald-600 dark:text-emerald-400",
	medium: "text-amber-600 dark:text-amber-400",
	high: "text-rose-600 dark:text-rose-400",
};

const FEE_LEVEL_LABELS: Record<string, string> = {
	low: "Low fee",
	medium: "Med fee",
	high: "High fee",
};

// ─── Sortable row ─────────────────────────────────────────────────────────────

function SortableMethodRow({
	method,
	onEdit,
	onDelete,
	onVisibilityChange,
}: {
	method: Method;
	onEdit: () => void;
	onDelete: () => void;
	onVisibilityChange: (v: Visibility) => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: method.localId });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	};

	const resolvedType = resolveMethodTypeId(method.type, method.currency);
	const def = getMethodType(resolvedType);
	const displayName = method.label || def?.name || method.type;
	const showCurrencyBadge =
		method.currency &&
		method.currency !== "*" &&
		!resolvedType.startsWith("crypto");

	const isCrypto = def?.category === "crypto";
	const networkLabel =
		isCrypto && method.network
			? (def?.networks?.find(
					(n) =>
						n.id === method.network ||
						n.shortName === method.network ||
						n.name === method.network,
				)?.shortName ?? method.network)
			: null;

	const visConfig = VISIBILITY_CONFIG.find(
		(v) => v.value === method.visibility,
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30",
						isDragging && "shadow-md",
					)}
					ref={setNodeRef}
					style={style}
				>
					{/* Drag handle */}
					<button
						{...attributes}
						{...listeners}
						aria-label="Drag to reorder"
						className="cursor-move touch-none text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/70"
						type="button"
					>
						<GripVertical className="h-4 w-4" />
					</button>

					{/* Icon */}
					<PaymentMethodIcon
						currency={method.currency}
						size="md"
						typeId={method.type}
					/>

					{/* Name + identifier */}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-medium text-sm">{displayName}</span>
							{isCrypto && networkLabel && (
								<span className="text-muted-foreground text-xs">
									· {networkLabel}
								</span>
							)}
							{showCurrencyBadge && (
								<Badge className="px-1.5 py-0 text-[10px]" variant="outline">
									{method.currency}
								</Badge>
							)}
						</div>
						{method.identifier && (
							<p className="mt-0.5 text-muted-foreground text-xs">
								{method.identifier}
							</p>
						)}
					</div>

					{/* Visibility badge */}
					{visConfig && (
						<div
							className={cn(
								"hidden shrink-0 items-center gap-1 text-xs sm:flex",
								visConfig.activeClass,
							)}
						>
							<span className="h-1.5 w-1.5 rounded-full bg-current" />
							<span>{visConfig.label}</span>
						</div>
					)}

					{/* Three-dot menu */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label="Method options"
								className="h-7 w-7 p-0"
								size="sm"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							<DropdownMenuItem onClick={onEdit}>
								<Pencil className="mr-2 h-3.5 w-3.5" />
								Edit
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="py-1 font-normal text-muted-foreground text-xs">
								Visibility
							</DropdownMenuLabel>
							{VISIBILITY_CONFIG.map((opt) => (
								<DropdownMenuItem
									className={cn(
										method.visibility === opt.value && "font-medium",
									)}
									key={opt.value}
									onClick={() => onVisibilityChange(opt.value)}
								>
									<span
										className={cn(
											"mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current",
											opt.activeClass,
										)}
									/>
									{opt.label}
									{method.visibility === opt.value && (
										<Check className="ml-auto h-3.5 w-3.5" />
									)}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onDelete} variant="destructive">
								<Trash2 className="mr-2 h-3.5 w-3.5" />
								Remove
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={onEdit}>
					<Pencil className="mr-2 h-3.5 w-3.5" />
					Edit
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuLabel className="py-1 font-normal text-muted-foreground text-xs">
					Visibility
				</ContextMenuLabel>
				{VISIBILITY_CONFIG.map((opt) => (
					<ContextMenuItem
						className={cn(method.visibility === opt.value && "font-medium")}
						key={opt.value}
						onClick={() => onVisibilityChange(opt.value)}
					>
						<span
							className={cn(
								"mr-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current",
								opt.activeClass,
							)}
						/>
						{opt.label}
						{method.visibility === opt.value && (
							<Check className="ml-auto h-3.5 w-3.5" />
						)}
					</ContextMenuItem>
				))}
				<ContextMenuSeparator />
				<ContextMenuItem onClick={onDelete} variant="destructive">
					<Trash2 className="mr-2 h-3.5 w-3.5" />
					Remove
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

interface MethodModalProps {
	open: boolean;
	onClose: () => void;
	onSave: (m: Method) => void;
	editing: Method | null; // null = adding new
	userCurrency: string;
}

function MethodModal({
	open,
	onClose,
	onSave,
	editing,
	userCurrency,
}: MethodModalProps) {
	const [step, setStep] = useState<"pick" | "form">(editing ? "form" : "pick");
	const [search, setSearch] = useState("");
	const [showAllRegions, setShowAllRegions] = useState(false);

	// Form state
	const [selectedType, setSelectedType] = useState(editing?.type ?? "");
	const [identifier, setIdentifier] = useState(editing?.identifier ?? "");
	const [label, setLabel] = useState(editing?.label ?? "");
	const [showLabel, setShowLabel] = useState(!!editing?.label);
	const [currency, setCurrency] = useState(editing?.currency ?? "");
	const [network, setNetwork] = useState(editing?.network ?? "");
	const [minAmount, setMinAmount] = useState(editing?.minAmount ?? "");
	const [visibility, setVisibility] = useState<Visibility>(
		editing?.visibility ?? "PAYMENT_ONLY",
	);

	const searchInputRef = useRef<HTMLInputElement>(null);

	// Reset when modal opens/closes
	useEffect(() => {
		if (open) {
			if (editing) {
				setStep("form");
				setSelectedType(editing.type);
				setIdentifier(editing.identifier);
				setLabel(editing.label);
				setShowLabel(!!editing.label);
				setCurrency(editing.currency);
				setNetwork(editing.network);
				setMinAmount(editing.minAmount);
				setVisibility(editing.visibility);
			} else {
				setStep("pick");
				setSearch("");
				setShowAllRegions(false);
				setSelectedType("");
				setIdentifier("");
				setLabel("");
				setShowLabel(false);
				setCurrency("");
				setNetwork("");
				setMinAmount("");
				setVisibility("PAYMENT_ONLY");
			}
		}
	}, [open, editing]);

	// Focus search input when picker opens
	useEffect(() => {
		if (step === "pick" && open) {
			requestAnimationFrame(() => searchInputRef.current?.focus());
		}
	}, [step, open]);

	const groups = useMemo(
		() => getMethodsByRegion(userCurrency),
		[userCurrency],
	);

	const filteredTypes = useMemo(() => {
		if (!search.trim()) return null;
		const q = search.toLowerCase();
		const { regional, global, crypto, other } = groups;
		return [...regional, ...global, ...other, ...crypto].filter(
			(m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
		);
	}, [search, groups]);

	function selectType(def: PaymentMethodTypeDef) {
		setSelectedType(def.id);
		setIdentifier("");
		setLabel("");
		setShowLabel(false);
		setNetwork(def.defaultNetwork ?? "");
		setMinAmount("");
		setVisibility("PAYMENT_ONLY");

		const fixedCurrency = getCurrencyForType(def.id);
		setCurrency(fixedCurrency ?? "");

		setSearch("");
		setStep("form");
	}

	function handleSave() {
		const def = getMethodType(selectedType);
		if (!def) return;

		if (def.identifierType !== "none" && !identifier.trim()) {
			toast.error(`${def.identifierLabel} is required`);
			return;
		}

		onSave({
			id: editing?.id,
			localId: editing?.localId ?? newLocalId(),
			type: selectedType,
			label: showLabel ? label : "",
			identifier: identifier.trim(),
			visibility,
			minAmount,
			currency,
			network,
		});
		onClose();
	}

	const typeDef = getMethodType(selectedType);
	const idConfig = getIdentifierConfig(selectedType);
	const networks = getNetworksForType(selectedType);
	const fixedCurrency = getCurrencyForType(selectedType);
	const isMultiCurrency =
		typeDef?.currencies.includes("*") || (typeDef?.currencies.length ?? 0) > 1;

	return (
		<ResponsiveDialog onOpenChange={(o) => !o && onClose()} open={open}>
			<ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
				{step === "pick" ? (
					<>
						<ResponsiveDialogHeader>
							<ResponsiveDialogTitle>Add Payment Method</ResponsiveDialogTitle>
							<ResponsiveDialogDescription>
								Choose a platform to get started.
							</ResponsiveDialogDescription>
						</ResponsiveDialogHeader>

						{/* Search */}
						<div className="relative">
							<Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
							<Input
								className="pl-9"
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search platforms..."
								ref={searchInputRef}
								value={search}
							/>
						</div>

						{/* Results / Grid */}
						{filteredTypes ? (
							<div className="space-y-2">
								{filteredTypes.length === 0 ? (
									<p className="py-4 text-center text-muted-foreground text-sm">
										No matching platforms
									</p>
								) : (
									<TypeGrid onSelect={selectType} types={filteredTypes} />
								)}
							</div>
						) : (
							<div className="space-y-4">
								{groups.regional.length > 0 && (
									<TypeSection
										label="Your region"
										onSelect={selectType}
										types={groups.regional}
									/>
								)}
								<TypeSection
									label="Global"
									onSelect={selectType}
									types={groups.global}
								/>
								{!showAllRegions && groups.other.length > 0 && (
									<Button
										className="w-full"
										onClick={() => setShowAllRegions(true)}
										type="button"
										variant="link"
										size="sm"
									>
										Show more regions
									</Button>
								)}
								{showAllRegions && groups.other.length > 0 && (
									<TypeSection
										label="Other regions"
										onSelect={selectType}
										types={groups.other}
									/>
								)}
								<TypeSection
									label="Crypto"
									onSelect={selectType}
									types={groups.crypto}
								/>
							</div>
						)}
					</>
				) : (
					<>
						<ResponsiveDialogHeader>
							<ResponsiveDialogTitle>
								{editing ? "Edit Payment Method" : "Add Payment Method"}
							</ResponsiveDialogTitle>
							{!editing && (
								<ResponsiveDialogDescription>
									<Button
										className="h-auto gap-1 p-0"
										onClick={() => setStep("pick")}
									type="button"
										variant="link"
									>
										<ArrowLeft className="h-3 w-3" />
										Back to platforms
									</Button>
								</ResponsiveDialogDescription>
							)}
						</ResponsiveDialogHeader>

						{typeDef && (
							<div className="space-y-4">
								{/* Type header */}
								<div className="flex items-center gap-3">
									<PaymentMethodIcon size="lg" typeId={selectedType} />
									<div>
										<p className="font-semibold">{typeDef.name}</p>
										{fixedCurrency && (
											<Badge
												className="mt-0.5 px-1.5 py-0 text-[10px]"
												variant="outline"
											>
												{fixedCurrency}
											</Badge>
										)}
									</div>
								</div>

								{/* Identifier */}
								{idConfig.type !== "none" && (
									<div className="space-y-1.5">
										<Label>{idConfig.label}</Label>
										<div className="flex gap-2">
											{idConfig.prefix && (
												<span className="flex h-9 items-center rounded-md border bg-muted px-2.5 text-muted-foreground text-sm">
													{idConfig.prefix}
												</span>
											)}
											<Input
												className={cn(
													"flex-1",
													idConfig.type === "wallet_address" &&
														"font-mono text-sm",
												)}
												maxLength={500}
												onChange={(e) => setIdentifier(e.target.value)}
												placeholder={idConfig.placeholder}
												value={identifier}
											/>
										</div>
									</div>
								)}

								{/* Network selector (crypto) */}
								{networks.length > 1 && (
									<div className="space-y-1.5">
										<Label>Network</Label>
										<div className="flex flex-wrap gap-1.5">
											{networks.map((net) => {
												const isActive = network === net.id;
												return (
													<Button
														className={cn(
															"h-auto gap-1.5 px-2.5 py-1.5 text-xs",
															isActive
																? "border-primary bg-primary/10 font-medium"
																: "",
														)}
														key={net.id}
														onClick={() => setNetwork(net.id)}
														type="button"
														variant="outline"
													>
														<span>{net.shortName}</span>
														<span
															className={cn(
																"text-[10px]",
																FEE_LEVEL_COLORS[net.feeLevel],
															)}
														>
															{FEE_LEVEL_LABELS[net.feeLevel]}
														</span>
													</Button>
												);
											})}
										</div>
									</div>
								)}

								{/* Currency (multi-currency types) */}
								{isMultiCurrency && (
									<div className="space-y-1.5">
										<Label>Currency</Label>
										<div className="w-32">
											<CurrencyPicker
												onValueChange={(v) => setCurrency(v)}
												triggerDisplay="code"
												value={
													(currency as CurrencyCode) || ("USD" as CurrencyCode)
												}
											/>
										</div>
									</div>
								)}

								{/* Display name */}
								{showLabel ? (
									<div className="space-y-1.5">
										<Label>Display name</Label>
										<Input
											maxLength={100}
											onChange={(e) => setLabel(e.target.value)}
											placeholder={typeDef.name}
											value={label}
										/>
									</div>
								) : (
									<Button
										className="h-auto p-0"
										onClick={() => setShowLabel(true)}
										type="button"
										variant="link"
										size="sm"
									>
										Add custom label
									</Button>
								)}

								{/* Min amount */}
								<div className="space-y-1.5">
									<Label>Minimum amount (optional)</Label>
									<div className="flex items-center gap-2">
										<Input
											className="w-32"
											min="0"
											onChange={(e) => setMinAmount(e.target.value)}
											placeholder="e.g. 500"
											step="0.01"
											type="number"
											value={minAmount}
										/>
										{(fixedCurrency || currency) && (
											<span className="text-muted-foreground text-sm">
												{fixedCurrency || currency}
											</span>
										)}
									</div>
									<p className="text-muted-foreground text-xs">
										Only suggest this method for amounts above this value
									</p>
								</div>

								{/* Visibility */}
								<div className="space-y-2">
									<Label>Visibility</Label>
									<div className="space-y-1.5">
										{(
											[
												{
													value: "PUBLIC" as Visibility,
													label: "Public",
													desc: "Visible on your profile page to anyone",
												},
												{
													value: "FRIENDS_ONLY" as Visibility,
													label: "Contacts",
													desc: "Visible to people you've split expenses with",
												},
												{
													value: "PAYMENT_ONLY" as Visibility,
													label: "Settlement only",
													desc: "Only shown when someone is settling up with you",
												},
											] as const
										).map((opt) => (
											<label
												className={cn(
													"flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
													visibility === opt.value
														? "border-primary bg-primary/5"
														: "hover:bg-muted/50",
												)}
												key={opt.value}
											>
												<input
													checked={visibility === opt.value}
													className="mt-0.5 accent-primary"
													name="pm-visibility"
													onChange={() => setVisibility(opt.value)}
													type="radio"
												/>
												<div>
													<span className="font-medium text-sm">
														{opt.label}
													</span>
													<p className="text-muted-foreground text-xs">
														{opt.desc}
													</p>
												</div>
											</label>
										))}
									</div>
								</div>
							</div>
						)}

						<ResponsiveDialogFooter>
							<Button onClick={onClose} variant="ghost">
								Cancel
							</Button>
							<Button onClick={handleSave}>
								{editing ? "Save Payment Method" : "Add Payment Method"}
							</Button>
						</ResponsiveDialogFooter>
					</>
				)}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

function TypeSection({
	label,
	types,
	onSelect,
}: {
	label: string;
	types: PaymentMethodTypeDef[];
	onSelect: (t: PaymentMethodTypeDef) => void;
}) {
	return (
		<div>
			<p className="mb-1.5 font-medium text-muted-foreground text-xs tracking-wide">
				{label}
			</p>
			<TypeGrid onSelect={onSelect} types={types} />
		</div>
	);
}

function TypeGrid({
	types,
	onSelect,
}: {
	types: PaymentMethodTypeDef[];
	onSelect: (t: PaymentMethodTypeDef) => void;
}) {
	return (
		<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
			{types.map((t) => (
				<Button
					className="flex h-auto flex-col items-center gap-1.5 px-2 py-2.5"
					key={t.id}
					onClick={() => onSelect(t)}
					type="button"
					variant="outline"
				>
					<PaymentMethodIcon size="md" typeId={t.id} />
					<span className="line-clamp-1 text-xs">{t.name}</span>
				</Button>
			))}
		</div>
	);
}

// ─── Pay Link Section ─────────────────────────────────────────────────────────

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & { username: string; image?: string | null };

function PayLinkSection() {
	const { data: session } = useSession();
	const { data: avatarData } = api.profile.getMyAvatar.useQuery();
	const [copied, setCopied] = useState<"pay" | "profile" | "donation" | null>(
		null,
	);

	const user = session?.user as ExtendedUser | undefined;
	const username = user?.username;
	if (!username) return null;

	const rawBaseUrl =
		typeof window !== "undefined"
			? window.location.origin
			: env.NEXT_PUBLIC_APP_URL;
	const baseUrl = rawBaseUrl.replace(/\/$/, "");
	const payUrl = `${baseUrl}/pay/${username}`;
	const profileUrl = `${baseUrl}/u/${username}`;
	const donationUrl = `${baseUrl}/u/${username}?donate`;

	const displayName = avatarData?.name || user?.name || username;
	const avatarUrl = avatarData?.avatarUrl ?? null;

	const handleCopy = (url: string, type: "pay" | "profile" | "donation") => {
		void navigator.clipboard.writeText(url);
		setCopied(type);
		toast.success("Copied!");
		setTimeout(() => setCopied(null), 2000);
	};

	return (
		<div className="space-y-2">
			{/* Preview card */}
			<div className="rounded-xl border bg-card p-4">
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-3">
						<UserAvatar avatarUrl={avatarUrl} name={displayName} size="sm" />
						<div className="min-w-0">
							<p className="truncate font-medium text-sm">{displayName}</p>
							<p className="truncate font-mono text-muted-foreground text-xs">
								{payUrl.replace(/^https?:\/\//, "")}
							</p>
						</div>
					</div>
					<Button
						className="shrink-0"
						onClick={() => handleCopy(payUrl, "pay")}
						size="sm"
					>
						{copied === "pay" ? (
							<>
								<Check className="mr-1.5 h-3.5 w-3.5" />
								Copied!
							</>
						) : (
							<>
								<Copy className="mr-1.5 h-3.5 w-3.5" />
								Copy Link
							</>
						)}
					</Button>
				</div>
			</div>

			{/* Action buttons */}
			<div className="flex flex-wrap items-center gap-1">
				<Button asChild size="sm" variant="ghost">
					<Link href={`/u/${username}`} target="_blank">
						<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
						View Profile
					</Link>
				</Button>
				<Button
					onClick={() => handleCopy(profileUrl, "profile")}
					size="sm"
					variant="ghost"
				>
					{copied === "profile" ? (
						<>
							<Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
							Copied!
						</>
					) : (
						<>
							<Link2 className="mr-1.5 h-3.5 w-3.5" />
							Copy Profile Link
						</>
					)}
				</Button>
				<Button
					onClick={() => handleCopy(donationUrl, "donation")}
					size="sm"
					variant="ghost"
				>
					{copied === "donation" ? (
						<>
							<Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
							Copied!
						</>
					) : (
						<>
							<Gift className="mr-1.5 h-3.5 w-3.5" />
							Copy Donation Link
						</>
					)}
				</Button>
			</div>
		</div>
	);
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function PaymentMethodsCard() {
	const { data: serverMethods, isLoading } = api.paymentMethod.list.useQuery();
	const upsertMutation = api.paymentMethod.upsert.useMutation({
		onSuccess: () => toast.success("Payment methods saved"),
		onError: () => toast.error("Failed to save payment methods"),
	});
	const { settings } = useUserSettings();
	const utils = api.useUtils();

	const [methods, setMethods] = useState<Method[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingMethod, setEditingMethod] = useState<Method | null>(null);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (serverMethods) {
			setMethods(
				serverMethods.map((m) => ({
					id: m.id,
					localId: newLocalId(),
					type: m.type,
					label: m.label ?? "",
					identifier: m.identifier ?? "",
					visibility: m.visibility as Visibility,
					minAmount: m.minAmount ? String(m.minAmount) : "",
					currency: m.currency ?? "",
					network: m.network ?? "",
				})),
			);
		}
	}, [serverMethods]);

	// ── DnD
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = methods.findIndex((m) => m.localId === active.id);
		const newIndex = methods.findIndex((m) => m.localId === over.id);
		const updated = arrayMove(methods, oldIndex, newIndex);
		setMethods(updated);
		saveAll(updated);
	}

	function saveAll(list: Method[]) {
		const input = list.map((m, i) => ({
			id: m.id,
			type: m.type,
			label: m.label || undefined,
			identifier: m.identifier || undefined,
			rank: i + 1,
			visibility: m.visibility,
			minAmount: m.minAmount ? parseFloat(m.minAmount) : undefined,
			currency: m.currency || undefined,
			network: m.network || undefined,
		}));
		upsertMutation.mutate(
			{ methods: input },
			{ onSuccess: () => void utils.paymentMethod.list.invalidate() },
		);
	}

	function handleVisibilityChange(localId: string, v: Visibility) {
		const next = methods.map((m) =>
			m.localId === localId ? { ...m, visibility: v } : m,
		);
		setMethods(next);
		saveAll(next);
	}

	function handleEdit(localId: string) {
		const m = methods.find((m) => m.localId === localId);
		if (m) {
			setEditingMethod(m);
			setModalOpen(true);
		}
	}

	function handleModalSave(updated: Method) {
		const existing = methods.find((m) => m.localId === updated.localId);
		let next: Method[];
		if (existing) {
			next = methods.map((m) => (m.localId === updated.localId ? updated : m));
		} else {
			next = [...methods, updated];
		}
		setMethods(next);
		saveAll(next);
	}

	function handleDelete(localId: string) {
		setShowDeleteConfirm(localId);
	}

	function confirmDelete() {
		if (!showDeleteConfirm) return;
		const next = methods.filter((m) => m.localId !== showDeleteConfirm);
		setMethods(next);
		setShowDeleteConfirm(null);
		saveAll(next);
	}

	const userCurrency = settings?.homeCurrency ?? "USD";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Payment Methods</CardTitle>
				<CardDescription>
					Configure how you prefer to receive payments when settling up. Drag to
					set your preferred order.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<PayLinkSection />

				{isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

				{/* Delete confirmation */}
				{showDeleteConfirm && (
					<div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
						<p className="text-sm">Remove this payment method?</p>
						<div className="flex gap-2">
							<Button
								onClick={() => setShowDeleteConfirm(null)}
								size="sm"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button onClick={confirmDelete} size="sm" variant="destructive">
								Remove
							</Button>
						</div>
					</div>
				)}

				{/* Empty state */}
				{!isLoading && methods.length === 0 && (
					<div className="flex flex-col items-center gap-3 py-8 text-center">
						<Wallet className="h-10 w-10 text-muted-foreground/40" />
						<div>
							<p className="font-medium text-sm">No payment methods yet</p>
							<p className="mt-1 text-muted-foreground text-xs">
								Add your payment methods so people know how to pay you
							</p>
						</div>
						<Button
							onClick={() => {
								setEditingMethod(null);
								setModalOpen(true);
							}}
							size="sm"
						>
							<Plus className="mr-1 h-3.5 w-3.5" />
							Add payment method
						</Button>
					</div>
				)}

				{/* Sortable list */}
				{methods.length > 0 && (
					<DndContext
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
						sensors={sensors}
					>
						<SortableContext
							items={methods.map((m) => m.localId)}
							strategy={verticalListSortingStrategy}
						>
							<div className="space-y-2">
								{methods.map((m) => (
									<SortableMethodRow
										key={m.localId}
										method={m}
										onDelete={() => handleDelete(m.localId)}
										onEdit={() => handleEdit(m.localId)}
										onVisibilityChange={(v) =>
											handleVisibilityChange(m.localId, v)
										}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				)}

				{/* Add button */}
				{methods.length > 0 && (
					<Button
						className="w-full border-dashed text-muted-foreground hover:text-foreground"
						onClick={() => {
							setEditingMethod(null);
							setModalOpen(true);
						}}
						size="sm"
						variant="outline"
					>
						<Plus className="mr-1 h-4 w-4" />
						Add payment method
					</Button>
				)}

				{/* Modal */}
				<MethodModal
					editing={editingMethod}
					onClose={() => {
						setModalOpen(false);
						setEditingMethod(null);
					}}
					onSave={handleModalSave}
					open={modalOpen}
					userCurrency={userCurrency}
				/>
			</CardContent>
		</Card>
	);
}
