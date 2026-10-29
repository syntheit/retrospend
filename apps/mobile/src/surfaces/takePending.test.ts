import { takePending } from "./useSurfaceLinks";

function native(pending: string | null) {
	return {
		consumePending: jest.fn(() => pending),
		releaseShared: jest.fn((_uri: string) => undefined),
	};
}

describe("takePending", () => {
	it("deletes the App Group copy of a shared file once taken in", () => {
		const n = native(
			'{"kind":"share","file":{"uri":"file:///group/shared/a.jpg","mime":"image/jpeg","name":"r.jpg"}}',
		);
		expect(takePending(n)?.file?.uri).toBe("file:///group/shared/a.jpg");
		expect(n.releaseShared).toHaveBeenCalledWith("file:///group/shared/a.jpg");
	});

	it("leaves an Android content URI alone", () => {
		const n = native(
			'{"kind":"share","file":{"uri":"content://x/1","mime":"image/jpeg","name":"r.jpg"}}',
		);
		takePending(n);
		expect(n.releaseShared).not.toHaveBeenCalled();
	});

	it("has nothing to delete for a text or with nothing waiting", () => {
		const text = native('{"kind":"share","text":"Taxi 18"}');
		expect(takePending(text)?.amount).toBe("18");
		expect(text.releaseShared).not.toHaveBeenCalled();
		expect(takePending(native(null))).toBeNull();
		expect(takePending(null)).toBeNull();
	});
});
