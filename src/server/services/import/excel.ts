import * as XLSX from "xlsx";

/**
 * The first sheet of an Excel file as CSV text, with a warning when the file
 * has more sheets. `verb` finishes that warning ("imported", "processed").
 */
export function excelToCsv(
	file: Buffer,
	verb: string,
): { csv: string; warnings: string[] } {
	try {
		const workbook = XLSX.read(file, { type: "buffer" });
		const warnings: string[] = [];
		if (workbook.SheetNames.length > 1) {
			warnings.push(
				`Excel file contains ${workbook.SheetNames.length} sheets. Only the first sheet "${workbook.SheetNames[0]}" will be ${verb}.`,
			);
		}
		const firstSheetName = workbook.SheetNames[0];
		if (!firstSheetName) throw new Error("Excel file contains no sheets");
		const worksheet = workbook.Sheets[firstSheetName];
		if (!worksheet) throw new Error("Failed to read Excel sheet");
		const csv = XLSX.utils.sheet_to_csv(worksheet);
		if (!csv.trim()) throw new Error("Excel sheet is empty");
		return { csv, warnings };
	} catch (error) {
		throw new Error(
			`Failed to process Excel file: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}
