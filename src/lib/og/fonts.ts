import { readFile } from "node:fs/promises";
import { join } from "node:path";

let cached: { name: string; data: ArrayBuffer; weight: 400 | 700 }[] | null =
	null;

export async function loadFonts() {
	if (cached) return cached;

	const dir = join(process.cwd(), "public", "fonts");
	const [regular, bold] = await Promise.all([
		readFile(join(dir, "DMSans-Regular.ttf")),
		readFile(join(dir, "DMSans-Bold.ttf")),
	]);

	cached = [
		{ name: "DM Sans", data: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength) as ArrayBuffer, weight: 400 },
		{ name: "DM Sans", data: bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength) as ArrayBuffer, weight: 700 },
	];
	return cached;
}
