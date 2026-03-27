"use client";

import { Camera, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageCropDialog } from "~/components/ui/image-crop-dialog";
import { toast } from "sonner";
import {
	type SplitParticipant,
	SplitWithPicker,
} from "~/components/split-with-picker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { CurrencyPicker } from "~/components/currency-picker";
import { useSettings } from "~/hooks/use-settings";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface NewProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({
	open,
	onOpenChange,
}: NewProjectDialogProps) {
	const router = useRouter();
	const utils = api.useUtils();
	const { data: settings } = useSettings();
	const homeCurrency = settings?.homeCurrency ?? "USD";

	const [name, setName] = useState("");
	const [type, setType] = useState<string>("GENERAL");
	const [description, setDescription] = useState("");
	const [budgetAmount, setBudgetAmount] = useState("");
	const [budgetCurrency, setBudgetCurrency] = useState(homeCurrency);
	const [billingCycleLength, setBillingCycleLength] = useState("MONTHLY");
	const [billingAutoClose, setBillingAutoClose] = useState(false);
	const [billingClosePermission, setBillingClosePermission] =
		useState("ORGANIZER_ONLY");
	const [participants, setParticipants] = useState<SplitParticipant[]>([]);
	const [coverImage, setCoverImage] = useState<File | null>(null);
	const [coverPreview, setCoverPreview] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Crop dialog state
	const [cropSrc, setCropSrc] = useState<string | null>(null);
	const [cropOpen, setCropOpen] = useState(false);

	const createMutation = api.project.create.useMutation({
		onSuccess: async (result) => {
			toast.success("Project created");
			void utils.project.list.invalidate();
			onOpenChange(false);

			// Upload icon if selected (non-blocking)
			if (coverImage && result.id) {
				const formData = new FormData();
				formData.append("file", coverImage);
				formData.append("projectId", result.id);
				try {
					const res = await fetch("/api/upload/project-image", {
						method: "POST",
						body: formData,
					});
					if (!res.ok) {
						toast.error(
							"Project created! Icon upload failed. You can add one later.",
						);
					}
				} catch {
					toast.error(
						"Project created! Icon upload failed. You can add one later.",
					);
				}
			}

			resetForm();
			router.push(`/projects/${result.id}`);
		},
		onError: (e) => toast.error(e.message),
	});

	const addParticipantMutation = api.project.addParticipant.useMutation({
		onError: (e) => toast.error(`Failed to add participant: ${e.message}`),
	});

	const resetForm = () => {
		setName("");
		setType("GENERAL");
		setDescription("");
		setBudgetAmount("");
		setBudgetCurrency(homeCurrency);
		setBillingCycleLength("MONTHLY");
		setBillingAutoClose(false);
		setBillingClosePermission("ORGANIZER_ONLY");
		setParticipants([]);
		if (coverPreview) URL.revokeObjectURL(coverPreview);
		setCoverImage(null);
		setCoverPreview(null);
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		setCropSrc(null);
		setCropOpen(false);
	};

	const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (cropSrc) URL.revokeObjectURL(cropSrc);
			setCropSrc(URL.createObjectURL(file));
			setCropOpen(true);
		}
		e.target.value = "";
	};

	const handleCroppedCover = (file: File) => {
		if (coverPreview) URL.revokeObjectURL(coverPreview);
		setCoverImage(file);
		setCoverPreview(URL.createObjectURL(file));
	};

	const removeCover = () => {
		if (coverPreview) URL.revokeObjectURL(coverPreview);
		setCoverImage(null);
		setCoverPreview(null);
	};

	const handleSubmit = async () => {
		if (!name.trim()) {
			toast.error("Project name is required");
			return;
		}

		const budget = budgetAmount ? parseFloat(budgetAmount) : undefined;
		if (
			budgetAmount &&
			(Number.isNaN(budget) || (budget !== undefined && budget <= 0))
		) {
			toast.error("Enter a valid budget amount");
			return;
		}

		const result = await createMutation.mutateAsync({
			name: name.trim(),
			type: type as "TRIP" | "ONGOING" | "SOLO" | "ONE_TIME" | "GENERAL",
			description: description.trim() || undefined,
			budgetAmount: budget,
			budgetCurrency: budget ? budgetCurrency : undefined,
			primaryCurrency: homeCurrency,
			billingCycleLength:
				type === "ONGOING"
					? (billingCycleLength as "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "CUSTOM")
					: undefined,
			billingAutoClose: type === "ONGOING" ? billingAutoClose : false,
			billingClosePermission:
				type === "ONGOING"
					? (billingClosePermission as "ORGANIZER_ONLY" | "ANY_PARTICIPANT")
					: "ORGANIZER_ONLY",
		});

		// Add participants after project creation
		if (participants.length > 0 && result.id) {
			await Promise.allSettled(
				participants.map((p) =>
					addParticipantMutation.mutateAsync({
						projectId: result.id,
						participantType: p.participantType as "user" | "guest" | "shadow",
						participantId: p.participantId,
						role: "CONTRIBUTOR",
					}),
				),
			);
		}
	};

	const isSolo = type === "SOLO";
	const isOngoing = type === "ONGOING";
	return (
		<>
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>New Project</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						Create a project to group related expenses.
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				<div className="space-y-4 py-2">
					{/* Project Icon */}
					<div className="flex flex-col items-center gap-1.5">
						{coverPreview ? (
							<div className="relative">
								<div className="h-20 w-20 overflow-hidden rounded-full">
									<img
										alt="Icon preview"
										className="h-full w-full object-cover"
										src={coverPreview}
									/>
								</div>
								<Button
									className="absolute -top-1 -right-1 h-auto w-auto rounded-full border border-border bg-background p-0.5 shadow-sm hover:bg-accent"
									onClick={removeCover}
									type="button"
									variant="ghost"
									size="icon"
								>
									<X className="h-3 w-3" />
								</Button>
							</div>
						) : (
							<Button
								className="h-20 w-20 rounded-full border-2 border-dashed border-muted-foreground/25 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
								onClick={() => fileInputRef.current?.click()}
								type="button"
								variant="ghost"
								size="icon"
							>
								<Camera className="h-6 w-6" />
							</Button>
						)}
						<span className="text-muted-foreground text-xs">
							Add icon (optional)
						</span>
						<input
							ref={fileInputRef}
							accept="image/jpeg,image/png,image/webp,image/gif"
							className="hidden"
							onChange={handleCoverSelect}
							type="file"
						/>
					</div>

					{/* Name */}
					<div className="space-y-1.5">
						<Label htmlFor="project-name">Name</Label>
						<Input
							autoFocus
							id="project-name"
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Misiones Roadtrip"
							value={name}
						/>
					</div>

					{/* Type */}
					<div className="space-y-1.5">
						<Label>Type</Label>
						<Select onValueChange={setType} value={type}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="TRIP">Trip</SelectItem>
								<SelectItem value="ONGOING">Ongoing</SelectItem>
								<SelectItem value="SOLO">Solo</SelectItem>
								<SelectItem value="GENERAL">General</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Description */}
					<div className="space-y-1.5">
						<Label htmlFor="project-desc">Description (optional)</Label>
						<textarea
							className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							id="project-desc"
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description..."
							rows={2}
							value={description}
						/>
					</div>

					{/* Budget */}
					<div className="space-y-1.5">
						<Label>Budget (optional)</Label>
						<div
							className={cn(
								"flex h-9 w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
							)}
						>
							<CurrencyPicker
								onValueChange={setBudgetCurrency}
								triggerClassName="h-full rounded-none border-r border-input px-3 shrink-0 focus-visible:ring-0"
								triggerDisplay="flag+code"
								triggerVariant="ghost"
								value={budgetCurrency}
							/>
							<Input
								className="h-full w-full border-0 bg-transparent px-3 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
								inputMode="decimal"
								onChange={(e) => setBudgetAmount(e.target.value)}
								placeholder="Amount"
								type="number"
								value={budgetAmount}
							/>
						</div>
					</div>

					{/* Billing config for Ongoing */}
					{isOngoing && (
						<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
							<div className="flex items-center gap-2">
								<Badge className="text-xs" variant="secondary">
									Billing Config
								</Badge>
							</div>
							<div className="space-y-1.5">
								<Label>Cycle Length</Label>
								<Select
									onValueChange={setBillingCycleLength}
									value={billingCycleLength}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="WEEKLY">Weekly</SelectItem>
										<SelectItem value="BIWEEKLY">Biweekly</SelectItem>
										<SelectItem value="MONTHLY">Monthly</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center justify-between">
								<Label className="cursor-pointer font-normal text-sm">
									Auto-Close Periods
								</Label>
								<Switch
									checked={billingAutoClose}
									onCheckedChange={setBillingAutoClose}
								/>
							</div>
							<div className="space-y-1.5">
								<Label>Close Permission</Label>
								<Select
									onValueChange={setBillingClosePermission}
									value={billingClosePermission}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="ORGANIZER_ONLY">
											Organizer Only
										</SelectItem>
										<SelectItem value="ANY_PARTICIPANT">
											Any Participant
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					)}

					{/* Participants */}
					{!isSolo && (
						<div className="space-y-1.5">
							<Label>Participants</Label>
							<SplitWithPicker
								onChange={setParticipants}
								value={participants}
							/>
						</div>
					)}
				</div>

				<ResponsiveDialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={createMutation.isPending || !name.trim()}
						onClick={handleSubmit}
					>
						{createMutation.isPending ? "Creating..." : "Create Project"}
					</Button>
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>

		<ImageCropDialog
			open={cropOpen}
			onOpenChange={setCropOpen}
			imageSrc={cropSrc}
			onCrop={handleCroppedCover}
			title="Crop Project Icon"
		/>
		</>
	);
}
