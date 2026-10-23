import { describe, expect, it } from "vitest";
import { sentenceName } from "./sentence-name";

describe("sentenceName", () => {
	it("English: the unit noun in lower case, places kept", () => {
		expect(sentenceName("Brazilian Real", "en")).toBe("Brazilian real");
		expect(sentenceName("US Dollar", "en")).toBe("US dollar");
		expect(sentenceName("South Korean Won", "en")).toBe("South Korean won");
		expect(sentenceName("Hong Kong Dollar", "en")).toBe("Hong Kong dollar");
		expect(sentenceName("Euro", "en")).toBe("Euro");
		expect(sentenceName("Bitcoin", "en")).toBe("Bitcoin");
	});

	it("other locales: the first letter up, the rest as given", () => {
		expect(sentenceName("real brasileño", "es-AR")).toBe("Real brasileño");
		expect(sentenceName("réal brésilien", "fr")).toBe("Réal brésilien");
		expect(sentenceName("бразильский реал", "ru")).toBe("Бразильский реал");
		expect(sentenceName("Brasilianischer Real", "de")).toBe(
			"Brasilianischer Real",
		);
		expect(sentenceName("Real brasileiro", "pt-BR")).toBe("Real brasileiro");
	});
});
