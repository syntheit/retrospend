// The export folder: a file is made inside it, deleted once the share sheet
// closes (also when sharing fails), and the whole folder is swept.

const mockDisk = new Set<string>();

jest.mock("expo-file-system", () => {
	class Directory {
		uri: string;
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = parts
				.map((p) => (typeof p === "string" ? p : p.uri))
				.join("/");
		}
		get exists() {
			return mockDisk.has(this.uri);
		}
		create() {
			mockDisk.add(this.uri);
		}
		delete() {
			for (const path of [...mockDisk])
				if (path === this.uri || path.startsWith(`${this.uri}/`))
					mockDisk.delete(path);
		}
	}
	class File extends Directory {
		delete() {
			mockDisk.delete(this.uri);
		}
	}
	return { Directory, File, Paths: { cache: { uri: "cache" } } };
});

import {
	exportFile,
	removeFile,
	shareThenDelete,
	sweepExports,
} from "./exportFiles";

beforeEach(() => mockDisk.clear());

describe("export files", () => {
	it("makes files in their own cache folder", () => {
		const file = exportFile("expenses.csv");
		expect(file.uri).toBe("cache/exports/expenses.csv");
		expect(mockDisk.has("cache/exports")).toBe(true);
	});

	it("deletes the file once the share sheet closes", async () => {
		const file = exportFile("retrospend.zip");
		mockDisk.add(file.uri);
		const share = jest.fn(async () => {
			expect(mockDisk.has(file.uri)).toBe(true);
		});
		await shareThenDelete(file, share);
		expect(share).toHaveBeenCalledWith(file);
		expect(mockDisk.has(file.uri)).toBe(false);
	});

	it("deletes the file when sharing fails too", async () => {
		const file = exportFile("wealth.csv");
		mockDisk.add(file.uri);
		await expect(
			shareThenDelete(file, async () => {
				throw new Error("no share sheet");
			}),
		).rejects.toThrow("no share sheet");
		expect(mockDisk.has(file.uri)).toBe(false);
	});

	it("sweeps every file left in the folder, and nothing else", () => {
		const a = exportFile("a.csv");
		const b = exportFile("b.zip");
		mockDisk.add(a.uri);
		mockDisk.add(b.uri);
		mockDisk.add("cache/other.db");
		sweepExports();
		expect([...mockDisk]).toEqual(["cache/other.db"]);
		// A second sweep, or removing a missing file, never throws.
		sweepExports();
		removeFile(a);
	});
});
