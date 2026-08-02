"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageCropDialog } from "~/components/ui/image-crop-dialog";
import { toast } from "sonner";
import { ProjectVisual } from "~/components/project/project-visual";
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
import { Separator } from "~/components/ui/separator";
import { CurrencyPicker } from "~/components/currency-picker";
import { Switch } from "~/components/ui/switch";
import { useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface ProjectSettingsDialogProps {
	isOrganizer: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project: {
		id: string;
		name: string;
		description: string | null;
		budgetAmount: number | null;
		budgetCurrency: string | null;
		primaryCurrency: string;
		status: string;
		billingCycleLength: string | null;
		billingCycleDays: number | null;
		billingAutoClose: boolean;
		billingCloseReminderDays: number;
		billingClosePermission: string;
		autoAcceptSplits: boolean;
		imagePath?: string | null;
	};
}

export function ProjectSettingsDialog({
	open,
	onOpenChange,
	project,
	isOrganizer,
}: ProjectSettingsDialogProps) {
	const t = useTranslations("projects");
	const router = useRouter();
	const utils = api.useUtils();

	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");
	const [primaryCurrency, setPrimaryCurrency] = useState(
		project.primaryCurrency,
	);
	const [budgetAmount, setBudgetAmount] = useState(
		project.budgetAmount ? String(project.budgetAmount) : "",
	);
	const [budgetCurrency, setBudgetCurrency] = useState(
		project.budgetCurrency ?? project.primaryCurrency,
	);
	const [billingCycleLength, setBillingCycleLength] = useState(
		project.billingCycleLength ?? "MONTHLY",
	);
	const [billingAutoClose, setBillingAutoClose] = useState(
		project.billingAutoClose,
	);
	const [billingClosePermission, setBillingClosePermission] = useState(
		project.billingClosePermission,
	);
	const [autoAcceptSplits, setAutoAcceptSplits] = useState(
		project.autoAcceptSplits,
	);

	// Image state
	const [imageUploading, setImageUploading] = useState(false);
	const imageInputRef = useRef<HTMLInputElement>(null);

	// Crop dialog state
	const [cropSrc, setCropSrc] = useState<string | null>(null);
	const [cropOpen, setCropOpen] = useState(false);

	// Danger zone state
	const [deleteConfirm, setDeleteConfirm] = useState("");
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const updateMutation = api.project.update.useMutation({
		onSuccess: () => {
			toast.success(t("projectUpdated"));
			void utils.project.detail.invalidate({ id: project.id });
			void utils.project.list.invalidate();
			onOpenChange(false);
		},
		onError: (e) => toast.error(e.message),
	});

	const archiveMutation = api.project.update.useMutation({
		onSuccess: () => {
			toast.success(t("projectArchived"));
			void utils.project.list.invalidate();
			onOpenChange(false);
			router.push("/projects");
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMutation = api.project.delete.useMutation({
		onSuccess: () => {
			toast.success(t("projectDeleted"));
			void utils.project.list.invalidate();
			onOpenChange(false);
			router.push("/projects");
		},
		onError: (e) => toast.error(e.message),
	});

	const handleImageUpload = async (file: File) => {
		setImageUploading(true);
		const formData = new FormData();
		formData.append("file", file);
		formData.append("projectId", project.id);
		try {
			const res = await fetch("/api/upload/project-image", {
				method: "POST",
				body: formData,
			});
			if (!res.ok) {
				let message = t("uploadFailed");
				try {
					const data = (await res.json()) as { error?: string };
					message = data.error ?? message;
				} catch {
					if (res.status === 413) message = t("fileTooLarge");
				}
				throw new Error(message);
			}
			void utils.project.detail.invalidate({ id: project.id });
			void utils.project.list.invalidate();
			toast.success(t("projectIconUpdated"));
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : t("failedToUploadIcon"),
			);
		} finally {
			setImageUploading(false);
		}
	};

	const handleImageRemove = async () => {
		setImageUploading(true);
		try {
			const res = await fetch(
				`/api/upload/project-image?projectId=${project.id}`,
				{ method: "DELETE" },
			);
			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? t("deleteFailed"));
			}
			void utils.project.detail.invalidate({ id: project.id });
			void utils.project.list.invalidate();
			toast.success(t("projectIconRemoved"));
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : t("failedToRemoveIcon"),
			);
		} finally {
			setImageUploading(false);
		}
	};

	const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			toast.error(t("fileTooLarge"));
			return;
		}
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		setCropSrc(URL.createObjectURL(file));
		setCropOpen(true);
	};

	const handleSave = () => {
		const budget = budgetAmount ? parseFloat(budgetAmount) : null;

		updateMutation.mutate({
			id: project.id,
			name: name.trim() || undefined,
			description: description.trim() || null,
			primaryCurrency,
			budgetAmount: budget,
			budgetCurrency: budget ? budgetCurrency : null,
			billingCycleLength: billingCycleLength as
					| "WEEKLY"
					| "BIWEEKLY"
					| "MONTHLY"
					| "CUSTOM",
			billingAutoClose,
			billingClosePermission: billingClosePermission as
					| "ORGANIZER_ONLY"
					| "ANY_PARTICIPANT",
			autoAcceptSplits,
		});
	};

	const hasBilling = project.billingCycleLength != null;

	return (
		<>
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>{t("projectSettings")}</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>{t("updateProjectConfiguration")}</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				<div className="space-y-4 py-2">
					{/* Project Icon */}
					<div className="space-y-2">
						<Label>{t("projectIcon")}</Label>
						<div className="flex items-center gap-4">
							<ProjectVisual
								editable={!imageUploading}
								imagePath={project.imagePath ?? null}
								onUpload={handleImageUpload}
								projectName={project.name}
								size="xl"
							/>
							<div className="flex flex-col gap-2">
								<Button
									disabled={imageUploading}
									onClick={() => imageInputRef.current?.click()}
									size="sm"
									type="button"
									variant="outline"
								>
									{imageUploading ? t("uploading") : t("changeIcon")}
								</Button>
								{project.imagePath && (
									<Button
										disabled={imageUploading}
										onClick={handleImageRemove}
										size="sm"
										type="button"
										variant="ghost"
									>
										{t("removeIcon")}
									</Button>
								)}
							</div>
						</div>
						<input
							ref={imageInputRef}
							accept="image/jpeg,image/png,image/webp,image/gif"
							className="hidden"
							onChange={handleImageFileSelect}
							type="file"
						/>
					</div>

					<div className="space-y-1.5">
						<Label>{t("name")}</Label>
						<Input onChange={(e) => setName(e.target.value)} value={name} />
					</div>

					<div className="space-y-1.5">
						<Label>{t("description")}</Label>
						<textarea
							className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							value={description}
						/>
					</div>

					<div className="space-y-1.5">
						<Label>{t("defaultCurrency")}</Label>
						<CurrencyPicker
							onValueChange={setPrimaryCurrency}
							triggerDisplay="flag+code"
							value={primaryCurrency}
						/>
						<p className="text-muted-foreground text-xs">
							{t("defaultCurrencyHint")}
						</p>
					</div>

					<div className="space-y-1.5">
						<Label>{t("budget")}</Label>
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
								onChange={(e) => setBudgetAmount(e.target.value)}
								placeholder={t("amount")}
								type="number"
								value={budgetAmount}
							/>
						</div>
					</div>

					{/* Shared expenses */}
					<div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
						<div className="space-y-0.5">
							<Label className="font-normal text-sm">
								{t("autoAcceptSplits")}
							</Label>
							<p className="text-muted-foreground text-xs">
								{t("autoAcceptSplitsDescription")}
							</p>
						</div>
						<Switch
							checked={autoAcceptSplits}
							onCheckedChange={setAutoAcceptSplits}
						/>
					</div>

					{/* Billing periods */}
					<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
						<div className="flex items-center justify-between">
							<Label className="cursor-pointer font-normal text-sm">
								{t("enableBillingPeriods")}
							</Label>
							<Switch
								checked={hasBilling}
								disabled
							/>
						</div>
						{hasBilling && (<>
							<div className="space-y-1.5">
								<Label>{t("cycleLength")}</Label>
								<Select
									onValueChange={setBillingCycleLength}
									value={billingCycleLength}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="WEEKLY">{t("cycleWeekly")}</SelectItem>
										<SelectItem value="BIWEEKLY">{t("cycleBiweekly")}</SelectItem>
										<SelectItem value="MONTHLY">{t("cycleMonthly")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center justify-between">
								<Label className="cursor-pointer font-normal text-sm">
									{t("autoClosePeriods")}
								</Label>
								<Switch
									checked={billingAutoClose}
									onCheckedChange={setBillingAutoClose}
								/>
							</div>
							<div className="space-y-1.5">
								<Label>{t("closePermission")}</Label>
								<Select
									onValueChange={setBillingClosePermission}
									value={billingClosePermission}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="ORGANIZER_ONLY">
											{t("ownerOnly")}
										</SelectItem>
										<SelectItem value="ANY_PARTICIPANT">
											{t("anyParticipant")}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</>)}
					</div>

					<Separator />

					{/* Danger Zone */}
					<div className="space-y-3">
						<h4 className="font-semibold text-destructive text-sm">
							{t("dangerZone")}
						</h4>

						<div className="rounded-lg border border-destructive/30 divide-y divide-destructive/30">
							<div className="flex items-center justify-between p-3">
								<div>
									<p className="font-medium text-sm">
										{project.status === "ACTIVE" ? t("archiveProject") : t("restoreProject")}
									</p>
									<p className="text-muted-foreground text-xs">
										{project.status === "ACTIVE"
											? t("archiveDescription")
											: t("restoreDescription")}
									</p>
								</div>
								<Button
									disabled={archiveMutation.isPending}
									onClick={() =>
										archiveMutation.mutate({
											id: project.id,
											status: project.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
										})
									}
									size="sm"
									variant="outline"
								>
									{project.status === "ACTIVE" ? t("archive") : t("restore")}
								</Button>
							</div>

							{isOrganizer && (
								<div className="p-3">
									<div className="flex items-center justify-between">
										<div>
											<p className="font-medium text-sm">{t("deleteProject")}</p>
											<p className="text-muted-foreground text-xs">
												{t("permanentlyDeleteProject")}
											</p>
										</div>
										{!showDeleteConfirm && (
											<Button
												onClick={() => setShowDeleteConfirm(true)}
												size="sm"
												variant="destructive"
											>
												{t("delete")}
											</Button>
										)}
									</div>
									{showDeleteConfirm && (
										<div className="mt-2 space-y-2">
											<p className="text-muted-foreground text-xs">
												{t("typeToConfirm", { name: project.name })}
											</p>
											<Input
												onChange={(e) => setDeleteConfirm(e.target.value)}
												placeholder={project.name}
												value={deleteConfirm}
											/>
											<div className="flex gap-2">
												<Button
													onClick={() => {
														setShowDeleteConfirm(false);
														setDeleteConfirm("");
													}}
													size="sm"
													variant="ghost"
												>
													{t("cancel")}
												</Button>
												<Button
													disabled={
														deleteConfirm !== project.name ||
														deleteMutation.isPending
													}
													onClick={() => deleteMutation.mutate({ id: project.id })}
													size="sm"
													variant="destructive"
												>
													{deleteMutation.isPending
														? t("deleting")
														: t("confirmDelete")}
												</Button>
											</div>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				</div>

				<ResponsiveDialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						{t("cancel")}
					</Button>
					<Button
						disabled={updateMutation.isPending || !name.trim()}
						onClick={handleSave}
					>
						{updateMutation.isPending ? t("saving") : t("saveChanges")}
					</Button>
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>

		<ImageCropDialog
			open={cropOpen}
			onOpenChange={setCropOpen}
			imageSrc={cropSrc}
			onCrop={(file) => void handleImageUpload(file)}
			title={t("cropProjectIcon")}
		/>
		</>
	);
}
