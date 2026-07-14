"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { ImageCropDialog } from "~/components/ui/image-crop-dialog";
import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";

export function AvatarUploadCard() {
	const t = useTranslations("settingsPage");
	const utils = api.useUtils();
	const { data: avatarData, isLoading } = api.profile.getMyAvatar.useQuery();

	const [localPreview, setLocalPreview] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [isRemoving, setIsRemoving] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Crop dialog state
	const [cropSrc, setCropSrc] = useState<string | null>(null);
	const [cropOpen, setCropOpen] = useState(false);

	const currentAvatarUrl = localPreview ?? avatarData?.avatarUrl ?? null;

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = "";
		if (file.size > 5 * 1024 * 1024) {
			toast.error(t("fileTooLarge"));
			return;
		}
		// Open crop dialog instead of uploading directly
		const objectUrl = URL.createObjectURL(file);
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		setCropSrc(objectUrl);
		setCropOpen(true);
	};

	const handleCroppedFile = async (file: File) => {
		setIsUploading(true);
		const previewUrl = URL.createObjectURL(file);
		setLocalPreview(previewUrl);

		try {
			const formData = new FormData();
			formData.append("file", file);

			const res = await fetch("/api/upload/avatar", {
				method: "POST",
				body: formData,
			});

			if (!res.ok) {
				let message = t("uploadFailed");
				try {
					const json = (await res.json()) as { error?: string };
					message = json.error ?? message;
				} catch {
					if (res.status === 413) message = t("fileTooLarge");
				}
				throw new Error(message);
			}

			URL.revokeObjectURL(previewUrl);
			setLocalPreview(null);
			void utils.profile.getMyAvatar.invalidate();
			toast.success(t("profilePictureUpdated"));
		} catch (err) {
			URL.revokeObjectURL(previewUrl);
			setLocalPreview(null);
			toast.error(err instanceof Error ? err.message : t("uploadFailed"));
		} finally {
			setIsUploading(false);
			if (cropSrc) {
				URL.revokeObjectURL(cropSrc);
				setCropSrc(null);
			}
		}
	};

	const handleRemove = async () => {
		setIsRemoving(true);
		try {
			const res = await fetch("/api/upload/avatar", { method: "DELETE" });
			if (!res.ok) {
				const json = (await res.json()) as { error?: string };
				throw new Error(json.error ?? t("removeFailed"));
			}
			void utils.profile.getMyAvatar.invalidate();
			toast.success(t("profilePictureRemoved"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("removeFailed"));
		} finally {
			setIsRemoving(false);
			setConfirmRemove(false);
		}
	};

	return (
		<>
			<Card className="border-border/50 shadow-sm">
				<CardHeader>
					<CardTitle>{t("profilePicture")}</CardTitle>
					<CardDescription>
						{t("profilePictureDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-6">
						{/* Avatar preview with loading overlay */}
						<div className="relative shrink-0">
							{isLoading ? (
								<div className="h-20 w-20 animate-pulse rounded-full bg-muted" />
							) : (
								<UserAvatar
									avatarUrl={currentAvatarUrl}
									name={avatarData?.name ?? "User"}
									size="xl"
								/>
							)}
							{isUploading && (
								<div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
									<Loader2 className="h-6 w-6 animate-spin text-white" />
								</div>
							)}
						</div>

						{/* Actions */}
						<div className="space-y-2">
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={isUploading || isRemoving}
									onClick={() => fileInputRef.current?.click()}
									size="sm"
									variant="outline"
								>
									{t("uploadPhoto")}
								</Button>
								{currentAvatarUrl && !confirmRemove && (
									<Button
										disabled={isUploading || isRemoving}
										onClick={() => setConfirmRemove(true)}
										size="sm"
										variant="ghost"
										className="text-destructive hover:text-destructive"
									>
										{t("removeButton")}
									</Button>
								)}
							</div>

							{confirmRemove && (
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">{t("removeProfilePictureConfirm")}</span>
									<Button
										disabled={isRemoving}
										onClick={handleRemove}
										size="sm"
										variant="destructive"
										className="h-7 px-2 text-xs"
									>
										{isRemoving ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											t("yesRemove")
										)}
									</Button>
									<Button
										disabled={isRemoving}
										onClick={() => setConfirmRemove(false)}
										size="sm"
										variant="ghost"
										className="h-7 px-2 text-xs"
									>
										{t("cancel")}
									</Button>
								</div>
							)}

							<p className="text-muted-foreground text-xs">
								{t("avatarFileHint")}
							</p>
						</div>
					</div>

					<input
						accept="image/jpeg,image/png,image/webp,image/gif"
						className="hidden"
						onChange={handleFileChange}
						ref={fileInputRef}
						type="file"
					/>
				</CardContent>
			</Card>

			<ImageCropDialog
				open={cropOpen}
				onOpenChange={setCropOpen}
				imageSrc={cropSrc}
				onCrop={handleCroppedFile}
				title={t("cropProfilePicture")}
			/>
		</>
	);
}
