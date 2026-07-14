"use client";

import {
	Camera,
	Folder,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { getImageUrl } from "~/lib/image-url";
import { cn } from "~/lib/utils";

function hashName(name: string): number {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) | 0;
	}
	return hash;
}

function nameToHueRotate(name: string): number {
	const h = hashName(name);
	return (h % 31) - 15; // -15 to +15
}

const DEFAULT_GRADIENT = "from-indigo-500 to-purple-600";

const SIZE_CLASSES: Record<string, string> = {
	xs: "h-6 w-6",
	sm: "h-8 w-8",
	md: "h-10 w-10",
	lg: "h-14 w-14",
	xl: "h-20 w-20",
};

const ICON_SIZES: Record<string, number> = {
	xs: 12,
	sm: 12,
	md: 16,
	lg: 20,
	xl: 28,
};

interface ProjectVisualProps {
	imagePath: string | null;
	projectName: string;
	size?: "xs" | "sm" | "md" | "lg" | "xl";
	className?: string;
	editable?: boolean;
	onUpload?: (file: File) => void;
}

export function ProjectVisual({
	imagePath,
	projectName,
	size = "md",
	className,
	editable = false,
	onUpload,
}: ProjectVisualProps) {
	const [imgError, setImgError] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const imageUrl = getImageUrl(imagePath);
	const showImage = imageUrl && !imgError;

	const gradient = DEFAULT_GRADIENT;
	const IconComponent = Folder;
	const iconSize = ICON_SIZES[size]!;
	const hueRotate = nameToHueRotate(projectName);

	// Only show edit overlay on lg/xl - too small on xs/sm/md
	const showEditOverlay = editable && (size === "lg" || size === "xl");

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file && onUpload) {
			onUpload(file);
		}
		e.target.value = "";
	};

	const handleClick = () => {
		if (showEditOverlay) {
			fileInputRef.current?.click();
		}
	};

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden rounded-full",
				SIZE_CLASSES[size],
				className,
			)}
		>
			{showImage ? (
				<Image
					alt={`${projectName} icon`}
					className="object-cover"
					fill
					onError={() => setImgError(true)}
					sizes="80px"
					src={imageUrl}
				/>
			) : (
				<div
					className={cn(
						"flex h-full w-full items-center justify-center bg-gradient-to-br",
						gradient,
					)}
					style={{ filter: `hue-rotate(${hueRotate}deg)` }}
				>
					<IconComponent
						className="text-white/25"
						size={iconSize}
						strokeWidth={1.5}
					/>
				</div>
			)}

			{showEditOverlay && (
				<>
					<div
						aria-label="Change icon"
						className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/0 opacity-0 transition-all duration-150 hover:bg-black/50 hover:opacity-100"
						onClick={handleClick}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleClick();
							}
						}}
						role="button"
						tabIndex={0}
					>
						<Camera className="h-5 w-5 text-white" />
					</div>
					<input
						ref={fileInputRef}
						accept="image/jpeg,image/png,image/webp,image/gif"
						className="hidden"
						onChange={handleFileSelect}
						type="file"
					/>
				</>
			)}
		</div>
	);
}
