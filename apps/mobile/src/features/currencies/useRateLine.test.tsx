import { useRateLine } from "./useRateLine";

// A rate line that could not be read says so; it never reads as a rate of 1.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockSession: { api: unknown } = { api: undefined };
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: mockSession.api }),
}));
jest.mock("@/lib/rateFormat", () => ({
	useRateFormat: () => ({
		typed: (type: string, base: string, currency: string, value: number) =>
			`${type} 1 ${base} = ${value} ${currency}`,
	}),
}));
jest.mock("@/lib/rateTypes", () => ({
	useRateTypeName: () => (type: string) => type,
}));

function Probe({
	onRead,
}: {
	onRead: (read: ReturnType<typeof useRateLine>) => void;
}) {
	onRead(useRateLine(true));
	return null;
}

async function mount(rateTable: () => Promise<unknown>) {
	mockSession.api = { currencies: { rateTable } };
	let last: ReturnType<typeof useRateLine> | undefined;
	await act(async () => {
		create(
			<Probe
				onRead={(read) => {
					last = read;
				}}
			/>,
		);
	});
	if (!last) throw new Error("not rendered");
	return () => last as ReturnType<typeof useRateLine>;
}

describe("useRateLine", () => {
	it("words a type with its number when the table answers", async () => {
		const read = await mount(async () => ({
			rows: [
				{
					code: "USD",
					rates: [
						{
							type: "blue",
							price: { base: "USD", currency: "ARS", minor: 154520, places: 2 },
						},
					],
				},
			],
		}));
		expect(read().failed).toBe(false);
		expect(read().line("USD", "blue")).toBe("blue 1 USD = 1545.2 ARS");
	});

	it("marks the read as failed and gives no number when the table cannot be read", async () => {
		const read = await mount(async () => {
			throw new Error("offline");
		});
		expect(read().failed).toBe(true);
		expect(read().line("USD", "blue")).toBeNull();
	});
});
