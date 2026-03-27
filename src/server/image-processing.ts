import sharp from "sharp";

const IMAGE_SIGNATURES: Record<string, number[]> = {
	jpeg: [0xff, 0xd8, 0xff],
	png: [0x89, 0x50, 0x4e, 0x47],
	webp: [0x52, 0x49, 0x46, 0x46], // RIFF header - also check bytes 8-11 for "WEBP"
	gif: [0x47, 0x49, 0x46], // "GIF"
};

export function validateImageBytes(buffer: Buffer): {
	valid: boolean;
	format: string | null;
} {
	if (buffer.length < 4) return { valid: false, format: null };

	for (const [format, signature] of Object.entries(IMAGE_SIGNATURES)) {
		const matches = signature.every((byte, i) => buffer[i] === byte);
		if (!matches) continue;

		// Extra check for WebP: bytes 8-11 must be "WEBP"
		if (format === "webp") {
			if (buffer.length < 12) return { valid: false, format: null };
			const webpMarker = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
			const hasWebpMarker = webpMarker.every(
				(byte, i) => buffer[8 + i] === byte,
			);
			if (!hasWebpMarker) continue;
		}

		return { valid: true, format };
	}

	return { valid: false, format: null };
}

function assertValidImage(buffer: Buffer): void {
	const { valid } = validateImageBytes(buffer);
	if (!valid) {
		throw new Error(
			"Invalid image format. Accepted formats: JPEG, PNG, WebP, GIF",
		);
	}
}

export async function processAvatar(input: Buffer): Promise<Buffer> {
	assertValidImage(input);

	return sharp(input)
		.rotate() // apply EXIF orientation before metadata is stripped
		.resize(400, 400, { fit: "cover", position: "centre" })
		.webp({ quality: 80 })
		.toBuffer();
}

export async function processProjectImage(input: Buffer): Promise<Buffer> {
	assertValidImage(input);

	return sharp(input)
		.rotate()
		.resize(400, 400, { fit: "cover", position: "centre" })
		.webp({ quality: 80 })
		.toBuffer();
}

export async function processReceipt(input: Buffer): Promise<Buffer> {
	assertValidImage(input);

	return sharp(input)
		.rotate()
		.resize(1200, undefined, { fit: "inside", withoutEnlargement: true })
		.webp({ quality: 85 })
		.toBuffer();
}
