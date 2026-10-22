"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { ImageCropDialog } from "~/components/ui/image-crop-dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { AVATAR_ACCEPT, useAvatarUpload } from "./use-avatar-upload";

/**
 * The profile picture row: the face, Upload photo and Remove. The file is
 * deleted on the server, so Remove asks first with a named button rather
 * than offering an Undo it could not keep.
 */
export function AvatarRow({ fallbackName }: { fallbackName: string }) {
	const t = useTranslations("settingsV2.profile");
	const avatar = useAvatarUpload();
	const [confirm, setConfirm] = useState(false);
	const busy = avatar.isUploading || avatar.isRemoving;
	const name = avatar.name || fallbackName;

	return (
		<div className="flex items-center gap-4">
			{avatar.isLoading ? (
				<Skeleton className="size-12 rounded-full" shape="face" />
			) : (
				<Face imageUrl={avatar.avatarUrl} name={name} size="lg" />
			)}
			<div className="min-w-0">
				<div className="flex flex-wrap gap-2">
					<Button
						kind="secondary"
						loading={avatar.isUploading}
						onClick={avatar.pick}
						size="sm"
					>
						{t("uploadPhoto")}
					</Button>
					{avatar.avatarUrl && (
						<Button
							disabled={busy}
							kind="ghost"
							onClick={() => setConfirm(true)}
							size="sm"
						>
							{t("removePhoto")}
						</Button>
					)}
				</div>
				<p className="mt-2 text-fg-3 text-meta">{t("photoHint")}</p>
			</div>
			<input
				accept={AVATAR_ACCEPT}
				className="hidden"
				onChange={avatar.onFileChange}
				ref={avatar.fileInputRef}
				type="file"
			/>
			<ImageCropDialog {...avatar.crop} title={t("cropTitle")} />
			<ConfirmationDialog
				confirmLabel={t("removePhotoConfirm")}
				description={t("removePhotoBody")}
				isLoading={avatar.isRemoving}
				onConfirm={async () => {
					await avatar.remove();
					setConfirm(false);
				}}
				onOpenChange={setConfirm}
				open={confirm}
				title={t("removePhotoTitle")}
				variant="destructive"
			/>
		</div>
	);
}
