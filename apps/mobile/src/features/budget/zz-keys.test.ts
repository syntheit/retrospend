import { applyKey } from "@/ui/keypad";

it("keys", () => {
	for (const loc of ["es-AR", "en-US"]) {
		let d = "";
		const out: string[] = [];
		for (const k of ["2", "0", "000", "000"]) {
			d = applyKey(d, k, loc, "ARS");
			out.push(d);
		}
		console.log(loc, out.join(" | "));
	}
});
