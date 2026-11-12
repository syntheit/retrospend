import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ dir: "" }));
vi.mock("~/env", () => ({
	env: {
		get UPLOAD_DIR() {
			return root.dir;
		},
	},
}));

root.dir = join(mkdtempSync(join(tmpdir(), "storage-test-")), "uploads");
mkdirSync(join(root.dir, "accounts"), { recursive: true });
const { deleteFile } = await import("./storage");

describe("deleteFile", () => {
	it("deletes a file inside the upload directory", async () => {
		const file = join(root.dir, "accounts", "a.webp");
		writeFileSync(file, "x");
		await deleteFile("accounts/a.webp");
		expect(existsSync(file)).toBe(false);
	});

	it.each(["../outside.txt", "accounts/../../outside.txt", "", "."])(
		"never deletes outside it (%j)",
		async (path) => {
			const outside = join(root.dir, "..", "outside.txt");
			writeFileSync(outside, "keep");
			await expect(deleteFile(path)).rejects.toThrow(/outside the upload/);
			expect(existsSync(outside)).toBe(true);
			expect(existsSync(root.dir)).toBe(true);
		},
	);
});
