import { dialogSlots } from "./alertSlots";

const cancel = { text: "Cancel", style: "cancel" as const };
const del = { text: "Delete", style: "destructive" as const };

describe("dialogSlots", () => {
	it("puts Cancel at the start and the one answer at the end", () => {
		expect(dialogSlots([cancel, del])).toEqual({
			cancel,
			confirm: del,
			choices: [],
		});
	});

	it("keeps the same slots when Cancel comes last", () => {
		expect(dialogSlots([del, cancel])).toEqual({
			cancel,
			confirm: del,
			choices: [],
		});
	});

	it("lists several answers in the body and leaves Cancel at the end", () => {
		const camera = { text: "Take photo" };
		const library = { text: "Choose photo" };
		expect(dialogSlots([camera, library, cancel])).toEqual({
			confirm: cancel,
			choices: [camera, library],
		});
	});

	it("shows a lone button as the confirm", () => {
		const ok = { text: "OK" };
		expect(dialogSlots([ok])).toEqual({ cancel: undefined, confirm: ok, choices: [] });
	});
});
