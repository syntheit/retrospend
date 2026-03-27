import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
	processAvatar,
	processProjectImage,
	processReceipt,
	validateImageBytes,
} from "../image-processing";

// ─── Test image factories ──────────────────────────────────────────────────

async function makeJpeg(width = 100, height = 100): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
	})
		.jpeg()
		.toBuffer();
}

async function makePng(width = 100, height = 100): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 0, g: 255, b: 0 } },
	})
		.png()
		.toBuffer();
}

async function makeWebp(width = 100, height = 100): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } },
	})
		.webp()
		.toBuffer();
}

async function makeGif(width = 100, height = 100): Promise<Buffer> {
	return sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 255, g: 255, b: 0 },
		},
	})
		.gif()
		.toBuffer();
}

// ─── validateImageBytes ────────────────────────────────────────────────────

describe("validateImageBytes", () => {
	it("accepts JPEG (FF D8 FF)", async () => {
		const buf = await makeJpeg();
		expect(validateImageBytes(buf)).toEqual({ valid: true, format: "jpeg" });
	});

	it("accepts PNG (89 50 4E 47)", async () => {
		const buf = await makePng();
		expect(validateImageBytes(buf)).toEqual({ valid: true, format: "png" });
	});

	it("accepts WebP (RIFF...WEBP)", async () => {
		const buf = await makeWebp();
		expect(validateImageBytes(buf)).toEqual({ valid: true, format: "webp" });
	});

	it("accepts GIF (47 49 46)", async () => {
		const buf = await makeGif();
		expect(validateImageBytes(buf)).toEqual({ valid: true, format: "gif" });
	});

	it("rejects PDF bytes (%PDF)", () => {
		const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
		expect(validateImageBytes(buf)).toEqual({ valid: false, format: null });
	});

	it("rejects plain text", () => {
		const buf = Buffer.from("This is not an image file");
		expect(validateImageBytes(buf)).toEqual({ valid: false, format: null });
	});

	it("rejects random bytes", () => {
		const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
		expect(validateImageBytes(buf)).toEqual({ valid: false, format: null });
	});

	it("rejects empty buffer", () => {
		expect(validateImageBytes(Buffer.alloc(0))).toEqual({
			valid: false,
			format: null,
		});
	});

	it("rejects 2-byte buffer (too short for any signature)", () => {
		expect(validateImageBytes(Buffer.from([0xff, 0xd8]))).toEqual({
			valid: false,
			format: null,
		});
	});

	it("rejects RIFF header without WEBP marker (e.g. WAV audio)", () => {
		// RIFF + size + "WAVE" - magic bytes match RIFF but not the WEBP sub-marker
		const buf = Buffer.from([
			0x52, 0x49, 0x46, 0x46, // "RIFF"
			0x00, 0x00, 0x00, 0x00, // file size placeholder
			0x57, 0x41, 0x56, 0x45, // "WAVE" (not "WEBP")
		]);
		expect(validateImageBytes(buf)).toEqual({ valid: false, format: null });
	});

	it("JPEG magic bytes with truncated body pass magic-byte check (format only, not structure)", () => {
		// validateImageBytes only checks magic bytes, not full image validity.
		// A buffer starting with FF D8 FF is reported as jpeg regardless of body.
		const buf = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);
		expect(validateImageBytes(buf)).toEqual({ valid: true, format: "jpeg" });
	});
});

// ─── processAvatar ─────────────────────────────────────────────────────────

describe("processAvatar", () => {
	it("converts 800×600 JPEG to 400×400 WebP (cover crop)", async () => {
		const input = await makeJpeg(800, 600);
		const output = await processAvatar(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(400);
		expect(meta.height).toBe(400);
	});

	it("upscales 200×200 PNG to 400×400 WebP", async () => {
		const input = await makePng(200, 200);
		const output = await processAvatar(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(400);
		expect(meta.height).toBe(400);
	});

	it("center-crops 400×800 portrait to 400×400 WebP", async () => {
		const input = await makeJpeg(400, 800);
		const output = await processAvatar(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(400);
		expect(meta.height).toBe(400);
	});

	it("converts GIF to 400×400 WebP", async () => {
		const input = await makeGif();
		const output = await processAvatar(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(400);
		expect(meta.height).toBe(400);
	});

	it("throws for plain text input", async () => {
		const buf = Buffer.from("This is not an image file");
		await expect(processAvatar(buf)).rejects.toThrow("Invalid image");
	});

	it("throws for empty buffer", async () => {
		await expect(processAvatar(Buffer.alloc(0))).rejects.toThrow();
	});
});

// ─── processProjectImage ───────────────────────────────────────────────────

describe("processProjectImage", () => {
	it("converts 1600×900 JPEG to 800×400 WebP (cover crop)", async () => {
		const input = await makeJpeg(1600, 900);
		const output = await processProjectImage(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(800);
		expect(meta.height).toBe(400);
	});

	it("crops 400×400 square to 800×400 WebP", async () => {
		const input = await makeJpeg(400, 400);
		const output = await processProjectImage(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(800);
		expect(meta.height).toBe(400);
	});

	it("throws for invalid input", async () => {
		await expect(
			processProjectImage(Buffer.from("not an image")),
		).rejects.toThrow("Invalid image");
	});
});

// ─── processReceipt ────────────────────────────────────────────────────────

describe("processReceipt", () => {
	it("resizes 3000×4000 JPEG to width 1200, height proportional (1600)", async () => {
		const input = await makeJpeg(3000, 4000);
		const output = await processReceipt(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(1200);
		expect(meta.height).toBe(1600); // 4000 × (1200 / 3000)
	});

	it("does not enlarge a 800×600 image (withoutEnlargement)", async () => {
		const input = await makeJpeg(800, 600);
		const output = await processReceipt(input);
		const meta = await sharp(output).metadata();
		expect(meta.format).toBe("webp");
		expect(meta.width).toBe(800);
		expect(meta.height).toBe(600);
	});

	it("throws for invalid input", async () => {
		await expect(processReceipt(Buffer.from("not an image"))).rejects.toThrow(
			"Invalid image",
		);
	});
});

// ─── EXIF stripping ────────────────────────────────────────────────────────

describe("EXIF stripping", () => {
	it("strips all EXIF metadata from processAvatar output", async () => {
		const baseJpeg = await makeJpeg(200, 200);

		// Embed EXIF metadata into the JPEG
		const withExif = await sharp(baseJpeg)
			.withMetadata({
				exif: { IFD0: { Make: "TestCamera", Model: "TestPhone" } },
			})
			.jpeg()
			.toBuffer();

		// Confirm EXIF was actually embedded (test setup sanity check)
		const preMeta = await sharp(withExif).metadata();
		expect(preMeta.exif).toBeDefined();

		// processAvatar does NOT call .withMetadata(), so sharp strips EXIF by default
		const output = await processAvatar(withExif);
		const outMeta = await sharp(output).metadata();
		expect(outMeta.exif).toBeUndefined();
	});
});
