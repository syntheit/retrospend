import { describe, expect, it } from "vitest";
import {
	parseRawCsv,
	parseCsv,
	parseBudgetCsv,
	parseWealthCsv,
	escapeValue,
	generateCsv,
} from "../csv";

describe("parseRawCsv", () => {
	it("parses simple CSV with headers and rows", () => {
		const csv = "name,age\nAlice,30\nBob,25";
		const { data, errors } = parseRawCsv(csv);
		expect(errors).toHaveLength(0);
		expect(data).toHaveLength(2);
		expect(data[0]).toEqual({ name: "Alice", age: "30" });
		expect(data[1]).toEqual({ name: "Bob", age: "25" });
	});

	it("handles quoted fields containing commas", () => {
		const csv = 'name,address\nAlice,"123 Main St, Suite 4"';
		const { data } = parseRawCsv(csv);
		expect(data[0]?.address).toBe("123 Main St, Suite 4");
	});

	it("handles escaped double quotes", () => {
		const csv = 'name,quote\nAlice,"she said ""hello"""';
		const { data } = parseRawCsv(csv);
		expect(data[0]?.quote).toBe('she said "hello"');
	});

	it("handles CRLF line endings", () => {
		const csv = "name,age\r\nAlice,30\r\nBob,25";
		const { data, errors } = parseRawCsv(csv);
		expect(errors).toHaveLength(0);
		expect(data).toHaveLength(2);
	});

	it("handles LF line endings", () => {
		const csv = "name,age\nAlice,30";
		const { data } = parseRawCsv(csv);
		expect(data).toHaveLength(1);
	});

	it("returns error on empty file", () => {
		const { data, errors } = parseRawCsv("");
		expect(data).toHaveLength(0);
		expect(errors).toHaveLength(1);
	});

	it("returns error on whitespace-only file", () => {
		const { data, errors } = parseRawCsv("   \n  ");
		expect(data).toHaveLength(0);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("skips empty lines in the middle", () => {
		const csv = "name,age\nAlice,30\n\nBob,25";
		const { data } = parseRawCsv(csv);
		expect(data).toHaveLength(2);
	});

	it("no phantom empty row from trailing newline", () => {
		const csv = "name,age\nAlice,30\n";
		const { data } = parseRawCsv(csv);
		expect(data).toHaveLength(1);
	});

	it("lowercases header names", () => {
		const csv = "Name,Age\nAlice,30";
		const { data } = parseRawCsv(csv);
		expect(data[0]).toHaveProperty("name");
		expect(data[0]).toHaveProperty("age");
	});
});

describe("parseCsv", () => {
	const validRow =
		"title,amount,currency,date\nCoffee,4.50,USD,2024-03-15";
	const validRowEur =
		"title,amount,currency,date,exchangeRate\nDinner,20,EUR,2024-03-15,1.08";

	it("parses a valid USD row", () => {
		const { rows, errors } = parseCsv(validRow);
		expect(errors).toHaveLength(0);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe("Coffee");
		expect(rows[0]?.amount).toBe(4.5);
		expect(rows[0]?.currency).toBe("USD");
		expect(rows[0]?.date).toBeInstanceOf(Date);
	});

	it("parses a valid non-USD row with exchangeRate", () => {
		const { rows, errors } = parseCsv(validRowEur);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.exchangeRate).toBe(1.08);
	});

	it("accepts amountInUSD as alternative to exchangeRate for non-USD", () => {
		const csv =
			"title,amount,currency,date,amountInUSD\nDinner,20,EUR,2024-03-15,21.60";
		const { rows, errors } = parseCsv(csv);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.amountInUSD).toBe(21.6);
	});

	it("errors on missing title", () => {
		const csv = "title,amount,currency,date\n,4.50,USD,2024-03-15";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/title/i);
	});

	it("errors on missing amount", () => {
		const csv = "title,amount,currency,date\nCoffee,,USD,2024-03-15";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/amount/i);
	});

	it("errors on missing required columns", () => {
		const csv = "title,amount\nCoffee,4.50";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/missing/i);
	});

	it("errors on invalid currency (not 3 chars)", () => {
		const csv = "title,amount,currency,date\nCoffee,4.50,US,2024-03-15";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/currency/i);
	});

	it("errors on invalid date format", () => {
		const csv = "title,amount,currency,date\nCoffee,4.50,USD,15-03-2024";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/date/i);
	});

	it("errors on non-USD currency without exchangeRate or amountInUSD", () => {
		const csv = "title,amount,currency,date\nDinner,20,EUR,2024-03-15";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/exchangeRate|amountInUSD/i);
	});

	it("USD currency without exchangeRate is OK (no error)", () => {
		const { rows, errors } = parseCsv(validRow);
		expect(errors).toHaveLength(0);
		expect(rows).toHaveLength(1);
	});

	it("negative amount produces error", () => {
		const csv = "title,amount,currency,date\nCoffee,-4.50,USD,2024-03-15";
		const { rows, errors } = parseCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/amount/i);
	});

	it("extra columns are ignored", () => {
		const csv =
			"title,amount,currency,date,extra\nCoffee,4.50,USD,2024-03-15,ignored";
		const { rows, errors } = parseCsv(csv);
		expect(errors).toHaveLength(0);
		expect(rows).toHaveLength(1);
	});

	it("uppercases the currency code", () => {
		const csv = "title,amount,currency,date\nCoffee,4.50,usd,2024-03-15";
		const { rows } = parseCsv(csv);
		expect(rows[0]?.currency).toBe("USD");
	});

	it("returns error on empty file", () => {
		const { rows, errors } = parseCsv("");
		expect(rows).toHaveLength(0);
		expect(errors.length).toBeGreaterThan(0);
	});
});

describe("parseBudgetCsv", () => {
	const validRow = "amount,period\n500,2024-03-01";

	it("parses a valid budget row", () => {
		const { rows, errors } = parseBudgetCsv(validRow);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.amount).toBe(500);
		expect(rows[0]?.period).toBeInstanceOf(Date);
	});

	it("accepts 'date' column instead of 'period'", () => {
		const csv = "amount,date\n500,2024-03-01";
		const { rows, errors } = parseBudgetCsv(csv);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.amount).toBe(500);
	});

	it("parses isRollover=true from string 'true'", () => {
		const csv = "amount,period,isRollover\n500,2024-03-01,true";
		const { rows } = parseBudgetCsv(csv);
		expect(rows[0]?.isRollover).toBe(true);
	});

	it("parses isRollover=true from string 'yes'", () => {
		const csv = "amount,period,isRollover\n500,2024-03-01,yes";
		const { rows } = parseBudgetCsv(csv);
		expect(rows[0]?.isRollover).toBe(true);
	});

	it("parses isRollover=true from string '1'", () => {
		const csv = "amount,period,isRollover\n500,2024-03-01,1";
		const { rows } = parseBudgetCsv(csv);
		expect(rows[0]?.isRollover).toBe(true);
	});

	it("parses isRollover=false from string 'false'", () => {
		const csv = "amount,period,isRollover\n500,2024-03-01,false";
		const { rows } = parseBudgetCsv(csv);
		expect(rows[0]?.isRollover).toBe(false);
	});

	it("errors when both amount and period columns are missing", () => {
		const csv = "categoryName\nFood";
		const { errors } = parseBudgetCsv(csv);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("errors on invalid period date", () => {
		const csv = "amount,period\n500,not-a-date";
		const { rows, errors } = parseBudgetCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/period|date/i);
	});

	it("accepts zero amount (non-negative threshold)", () => {
		const csv = "amount,period\n0,2024-03-01";
		const { rows, errors } = parseBudgetCsv(csv);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.amount).toBe(0);
	});

	it("errors on negative amount", () => {
		const csv = "amount,period\n-100,2024-03-01";
		const { rows, errors } = parseBudgetCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/amount/i);
	});
});

describe("parseWealthCsv", () => {
	const validRow = "name,type,currency,balance\nSavings,SAVINGS,USD,10000";

	it("parses a valid wealth row", () => {
		const { rows, errors } = parseWealthCsv(validRow);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.name).toBe("Savings");
		expect(rows[0]?.balance).toBe(10000);
		expect(rows[0]?.currency).toBe("USD");
	});

	it("accepts negative balance (liabilities)", () => {
		const csv = "name,type,currency,balance\nMortgage,LIABILITY,USD,-250000";
		const { rows, errors } = parseWealthCsv(csv);
		expect(errors).toHaveLength(0);
		expect(rows[0]?.balance).toBe(-250000);
	});

	it("errors on missing name", () => {
		const csv = "name,type,currency,balance\n,SAVINGS,USD,10000";
		const { rows, errors } = parseWealthCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/name/i);
	});

	it("errors on missing required columns", () => {
		const csv = "name,balance\nSavings,10000";
		const { errors } = parseWealthCsv(csv);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("errors on invalid currency", () => {
		const csv = "name,type,currency,balance\nSavings,SAVINGS,US,10000";
		const { rows, errors } = parseWealthCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toMatch(/currency/i);
	});

	it("uppercases currency and type", () => {
		const csv = "name,type,currency,balance\nSavings,savings,usd,10000";
		const { rows } = parseWealthCsv(csv);
		expect(rows[0]?.currency).toBe("USD");
		expect(rows[0]?.type).toBe("SAVINGS");
	});
});

describe("escapeValue", () => {
	it("returns empty string for null", () => {
		expect(escapeValue(null)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(escapeValue(undefined)).toBe("");
	});

	it("converts Date to YYYY-MM-DD format", () => {
		const d = new Date(2024, 2, 15); // March 15, 2024
		expect(escapeValue(d)).toBe("2024-03-15");
	});

	it("converts number to string", () => {
		expect(escapeValue(123.45)).toBe("123.45");
	});

	it("negative number is NOT prefixed (numeric, not formula injection)", () => {
		expect(escapeValue(-100)).toBe("-100");
	});

	it("string starting with = gets prefixed with quote", () => {
		expect(escapeValue("=SUM(A1)")).toBe("'=SUM(A1)");
	});

	it("string starting with + gets prefixed", () => {
		expect(escapeValue("+tax")).toBe("'+tax");
	});

	it("string starting with - gets prefixed", () => {
		expect(escapeValue("-discount")).toBe("'-discount");
	});

	it("string starting with @ gets prefixed", () => {
		expect(escapeValue("@user")).toBe("'@user");
	});

	it("string starting with tab gets prefixed", () => {
		expect(escapeValue("\there")).toBe("'\there");
	});

	it("string starting with CR gets prefixed", () => {
		expect(escapeValue("\rhere")).toBe("'\rhere");
	});

	it("plain string without special chars is unchanged", () => {
		expect(escapeValue("hello world")).toBe("hello world");
	});

	it("wraps string containing comma in quotes", () => {
		expect(escapeValue("hello, world")).toBe('"hello, world"');
	});

	it("escapes embedded double quotes by doubling", () => {
		expect(escapeValue('she said "hi"')).toBe('"she said ""hi"""');
	});

	it("wraps string containing newline in quotes", () => {
		expect(escapeValue("line1\nline2")).toBe('"line1\nline2"');
	});
});

describe("generateCsv", () => {
	it("combines headers and rows", () => {
		const result = generateCsv(["name", "age"], [["Alice", 30], ["Bob", 25]]);
		expect(result).toBe("name,age\nAlice,30\nBob,25");
	});

	it("applies escaping to values", () => {
		const result = generateCsv(["name"], [["hello, world"]]);
		expect(result).toBe('name\n"hello, world"');
	});

	it("handles no data rows", () => {
		const result = generateCsv(["name", "age"], []);
		expect(result).toBe("name,age");
	});

	it("does not end with trailing newline", () => {
		const result = generateCsv(["name"], [["Alice"]]);
		expect(result.endsWith("\n")).toBe(false);
	});

	it("handles null and undefined values", () => {
		const result = generateCsv(["a", "b"], [[null, undefined]]);
		expect(result).toBe("a,b\n,");
	});
});
