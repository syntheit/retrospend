"use client";

import { useTranslations } from "next-intl";
import { type ChangeEvent, useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

const MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * The profile picture flow: pick a file (5 MB at most), crop it, upload it
 * to /api/upload/avatar; remove deletes it. The same calls and limits as
 * today's AvatarUploadCard, with the new page's toasts.
 */
export function useAvatarUpload() {
	const t = useTranslations("settingsV2.profile");
	const toast = useToast();
	const utils = api.useUtils();
	const { data: avatar, isLoading } = api.profile.getMyAvatar.useQuery();
	const [localPreview, setLocalPreview] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [isRemoving, setIsRemoving] = useState(false);
	const [cropSrc, setCropSrc] = useState<string | null>(null);
	const [cropOpen, setCropOpen] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = "";
		if (file.size > MAX_BYTES) {
			toast.failed(t("photoTooLarge"));
			return;
		}
		if (cropSrc) URL.revokeObjectURL(cropSrc);
		setCropSrc(URL.createObjectURL(file));
		setCropOpen(true);
	};

	const upload = async (file: File) => {
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
			// The route answers in English; the toast says it in the user's words.
			if (res.status === 413) toast.failed(t("photoTooLarge"));
			else if (!res.ok) toast.failed(t("photoUploadFailed"));
			else {
				void utils.profile.getMyAvatar.invalidate();
				toast.saved(t("photoUpdated"));
			}
		} catch {
			toast.failed(t("photoUploadFailed"));
		} finally {
			URL.revokeObjectURL(previewUrl);
			setLocalPreview(null);
			setIsUploading(false);
			if (cropSrc) {
				URL.revokeObjectURL(cropSrc);
				setCropSrc(null);
			}
		}
	};

	const remove = async () => {
		setIsRemoving(true);
		try {
			const res = await fetch("/api/upload/avatar", { method: "DELETE" });
			if (!res.ok) throw new Error(String(res.status));
			void utils.profile.getMyAvatar.invalidate();
			toast.saved(t("photoRemoved"));
		} catch {
			toast.failed(t("photoRemoveFailed"));
		} finally {
			setIsRemoving(false);
		}
	};

	return {
		avatarUrl: localPreview ?? avatar?.avatarUrl ?? null,
		name: avatar?.name ?? "",
		isLoading,
		isUploading,
		isRemoving,
		fileInputRef,
		pick: () => fileInputRef.current?.click(),
		onFileChange,
		crop: {
			open: cropOpen,
			onOpenChange: setCropOpen,
			imageSrc: cropSrc,
			onCrop: upload,
		},
		remove,
	};
}
