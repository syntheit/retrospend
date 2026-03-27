import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_UPLOAD_DIR = join(__dirname, ".test-uploads");

vi.mock("~/env", () => ({
	env: {
		UPLOAD_DIR: join(__dirname, ".test-uploads"),
	},
}));

import {
	deleteFile,
	getFileStream,
	getImageUrl,
	getStorageSize,
	uploadFile,
} from "../storage";

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(() => {
	mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
});

beforeEach(() => {
	// Clean upload dir between tests
	rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
	mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
});

// ─── getImageUrl ────────────────────────────────────────────────────────────

describe("getImageUrl", () => {
	it("returns null for null input", () => {
		expect(getImageUrl(null)).toBeNull();
	});

	it("returns /api/images/{path} for an avatar path", () => {
		expect(getImageUrl("avatars/abc.webp")).toBe("/api/images/avatars/abc.webp");
	});

	it("returns /api/images/{path} for a project path", () => {
		expect(getImageUrl("projects/xyz.webp")).toBe(
			"/api/images/projects/xyz.webp",
		);
	});

	it("returns /api/images/{path} for any non-empty string", () => {
		expect(getImageUrl("receipts/r-123.webp")).toBe(
			"/api/images/receipts/r-123.webp",
		);
	});
});

// ─── uploadFile ─────────────────────────────────────────────────────────────

describe("uploadFile", () => {
	it("writes the file to disk and returns the path", async () => {
		const buf = Buffer.from("webp-data");
		const result = await uploadFile("avatars/u-1.webp", buf, "image/webp");

		expect(result).toBe("avatars/u-1.webp");
		const written = readFileSync(join(TEST_UPLOAD_DIR, "avatars/u-1.webp"));
		expect(written.toString()).toBe("webp-data");
	});

	it("creates nested directories automatically", async () => {
		const buf = Buffer.from("deep");
		await uploadFile("projects/abc/nested.webp", buf, "image/webp");
		expect(
			existsSync(join(TEST_UPLOAD_DIR, "projects/abc/nested.webp")),
		).toBe(true);
	});

	it("overwrites an existing file atomically", async () => {
		const buf1 = Buffer.from("first");
		const buf2 = Buffer.from("second");
		await uploadFile("avatars/u-1.webp", buf1, "image/webp");
		await uploadFile("avatars/u-1.webp", buf2, "image/webp");

		const written = readFileSync(join(TEST_UPLOAD_DIR, "avatars/u-1.webp"));
		expect(written.toString()).toBe("second");
	});
});

// ─── deleteFile ─────────────────────────────────────────────────────────────

describe("deleteFile", () => {
	it("removes the file from disk", async () => {
		await uploadFile("avatars/u-1.webp", Buffer.from("x"), "image/webp");
		expect(existsSync(join(TEST_UPLOAD_DIR, "avatars/u-1.webp"))).toBe(true);

		await deleteFile("avatars/u-1.webp");
		expect(existsSync(join(TEST_UPLOAD_DIR, "avatars/u-1.webp"))).toBe(false);
	});

	it("does not throw when file does not exist (idempotent)", async () => {
		await expect(deleteFile("avatars/ghost.webp")).resolves.not.toThrow();
	});
});

// ─── getFileStream ──────────────────────────────────────────────────────────

describe("getFileStream", () => {
	it("returns a readable stream of the file contents", async () => {
		await uploadFile("avatars/u-1.webp", Buffer.from("hello"), "image/webp");

		const stream = await getFileStream("avatars/u-1.webp");
		const chunks: Buffer[] = [];
		for await (const chunk of stream as Readable) {
			chunks.push(Buffer.from(chunk as Buffer));
		}
		expect(Buffer.concat(chunks).toString()).toBe("hello");
	});

	it("throws when file does not exist", async () => {
		await expect(getFileStream("avatars/missing.webp")).rejects.toThrow();
	});
});

// ─── getStorageSize ─────────────────────────────────────────────────────────

describe("getStorageSize", () => {
	it("returns 0 for an empty directory", async () => {
		expect(await getStorageSize()).toBe(0);
	});

	it("returns the total size of all files", async () => {
		const buf1 = Buffer.from("aaaa"); // 4 bytes
		const buf2 = Buffer.from("bbbbbb"); // 6 bytes
		await uploadFile("avatars/a.webp", buf1, "image/webp");
		await uploadFile("projects/b.webp", buf2, "image/webp");

		expect(await getStorageSize()).toBe(10);
	});
});
