import { inflateSync } from "node:zlib";

/**
 * The text a PDF from pdfkit shows, one string per text run in drawing
 * order. Enough to compare two documents by what a person reads; the bytes
 * differ on every run (dates, ids).
 */
export function pdfText(pdf: Buffer): string[] {
	const raw = pdf.toString("latin1");
	const runs: string[] = [];
	for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		let content: string;
		try {
			content = inflateSync(Buffer.from(stream[1] ?? "", "latin1")).toString(
				"latin1",
			);
		} catch {
			continue;
		}
		for (const op of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
			const hex = [...(op[1] ?? "").matchAll(/<([0-9a-f]*)>/gi)].map(
				(m) => m[1] ?? "",
			);
			runs.push(Buffer.from(hex.join(""), "hex").toString("latin1"));
		}
	}
	return runs;
}
