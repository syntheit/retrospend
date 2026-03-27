"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area, type MediaSize } from "react-easy-crop";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Slider } from "~/components/ui/slider";

interface ImageCropDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	imageSrc: string | null;
	onCrop: (file: File) => void;
	title?: string;
}

async function getCroppedBlob(
	imageSrc: string,
	pixelCrop: Area,
): Promise<Blob> {
	const image = new Image();
	image.crossOrigin = "anonymous";
	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = reject;
		image.src = imageSrc;
	});

	const outputSize = Math.min(image.naturalWidth, image.naturalHeight);

	const canvas = document.createElement("canvas");
	canvas.width = outputSize;
	canvas.height = outputSize;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not get canvas context");

	ctx.drawImage(
		image,
		pixelCrop.x,
		pixelCrop.y,
		pixelCrop.width,
		pixelCrop.height,
		0,
		0,
		outputSize,
		outputSize,
	);

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error("Failed to create image blob"));
			},
			"image/webp",
			0.92,
		);
	});
}

export function ImageCropDialog({
	open,
	onOpenChange,
	imageSrc,
	onCrop,
	title = "Crop Image",
}: ImageCropDialogProps) {
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [cropSize, setCropSize] = useState<
		{ width: number; height: number } | undefined
	>();
	const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const cropContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (imageSrc) {
			setCrop({ x: 0, y: 0 });
			setZoom(1);
			setCropSize(undefined);
			setCroppedAreaPixels(null);
		}
	}, [imageSrc]);

	const onMediaLoaded = useCallback((_mediaSize: MediaSize) => {
		// Force the crop circle to fill the container's shortest side.
		// objectFit="cover" ensures the image covers this area at zoom=1.
		const container = cropContainerRef.current;
		const w = container?.offsetWidth ?? 340;
		const h = container?.offsetHeight ?? 256;
		const size = Math.min(w, h);
		setCropSize({ width: size, height: size });
	}, []);

	const onCropComplete = useCallback((_: Area, pixels: Area) => {
		setCroppedAreaPixels(pixels);
	}, []);

	const handleConfirm = async () => {
		if (!imageSrc || !croppedAreaPixels) return;
		setIsProcessing(true);
		try {
			const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
			const file = new File([blob], "image.webp", { type: "image/webp" });
			onCrop(file);
			onOpenChange(false);
		} catch {
			toast.error("Failed to process image. Please try a different file.");
		} finally {
			setIsProcessing(false);
		}
	};

	if (!imageSrc) return null;

	return (
		<ResponsiveDialog open={open} onOpenChange={onOpenChange}>
			<ResponsiveDialogContent className="gap-5 sm:max-w-sm">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
					<ResponsiveDialogDescription className="sr-only">Crop and resize your image</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				<div
					ref={cropContainerRef}
					className="relative mx-auto aspect-square w-full max-w-64 max-h-[50dvh] overflow-hidden rounded-2xl bg-black/90"
				>
					<Cropper
						image={imageSrc}
						crop={crop}
						zoom={zoom}
						aspect={1}
						cropShape="round"
						objectFit="cover"
						cropSize={cropSize}
						showGrid={false}
						onCropChange={setCrop}
						onZoomChange={setZoom}
						onCropComplete={onCropComplete}
						onMediaLoaded={onMediaLoaded}
						style={{
							containerStyle: { borderRadius: "1rem" },
							cropAreaStyle: {
								border: "2px solid rgba(255,255,255,0.8)",
								boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
							},
						}}
					/>
				</div>

				<div className="space-y-2 px-1">
					<p className="text-muted-foreground text-xs font-medium tracking-wide">
						Zoom
					</p>
					<Slider
						min={1}
						max={3}
						step={0.01}
						value={[zoom]}
						onValueChange={([v]) => v !== undefined && setZoom(v)}
					/>
				</div>

				<ResponsiveDialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={isProcessing || !croppedAreaPixels}
					>
						{isProcessing ? "Applying..." : "Apply Crop"}
					</Button>
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
