// Catches: the sidecar's progress phrases (sidecar/main.go, importer/pdf,
// importer/llm) drifting from the codes the queue stores (E2EE D11 Revision 3,
// PR 5), and API v1's `message` changing text for a job read before the codes.
import { describe, expect, it } from "vitest";
import { progressCode, progressText } from "./progress-code";

/** Every phrase the sidecar sends, as written in its source, with its code. */
const SIDECAR: [phrase: string, code: string][] = [
	["Extracting text from PDF...", "reading"],
	["Detecting CSV format...", "detecting"],
	["Parsing transactions...", "parsing"],
	["Parsing bank statement...", "parsing_statement"],
	["Parsing bank statement (pages 1-3)...", "parsing_pages:1-3"],
	["Parsing bank statement (pages 10-20)...", "parsing_pages:10-20"],
	["Parsing bank statement (2/7 chunks)...", "parsing_chunks:2/7"],
	["Enriching transactions...", "enriching"],
	["Enriching transactions (batch 1/4)...", "enriching_batch:1/4"],
	["Enriching transactions (batch 4/4)...", "enriching_batch:4/4"],
];

describe("progressCode", () => {
	it.each(SIDECAR)("maps %s to %s", (phrase, code) => {
		expect(progressCode(phrase)).toBe(code);
	});

	it("stores null for text that is not on the list, however close", () => {
		for (const text of [
			"",
			"Row 3: Coto Supermercado, ARS 12.500",
			"Parsing bank statement (pages 1-3)",
			"Parsing bank statement (pages a-b)...",
			"Parsing bank statement (pages 1234567-2)...",
			"Enriching transactions (batch 1/4)... extra",
			" Enriching transactions...",
			"complete",
		])
			expect(progressCode(text), text).toBeNull();
		expect(progressCode(undefined)).toBeNull();
		expect(progressCode(42)).toBeNull();
	});
});

describe("progressText", () => {
	it.each(SIDECAR)("renders the code of %s as that phrase", (phrase, code) => {
		expect(progressText(code)).toBe(phrase);
	});

	it("renders complete as the phrase the server wrote before", () => {
		expect(progressText("complete")).toBe("Complete");
	});

	it("passes a row from before the codes through as it was stored", () => {
		for (const legacy of [
			"Complete",
			"Detecting CSV format...",
			"Enriching transactions (batch 3/9)...",
			"anything the sidecar once said",
		])
			expect(progressText(legacy)).toBe(legacy);
	});

	it("keeps null and an unknown code as they are", () => {
		expect(progressText(null)).toBeNull();
		expect(progressText("parsing_pages:x-y")).toBe("parsing_pages:x-y");
	});

	it("is the inverse of progressCode for every phrase", () => {
		for (const [phrase] of SIDECAR)
			expect(progressText(progressCode(phrase))).toBe(phrase);
	});
});
