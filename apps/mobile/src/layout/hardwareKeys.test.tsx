import { commandsFor, useHardwareKeys } from "./useHardwareKeys";

// Cmd+N and Cmd+F: the commands handed to the native module, the events
// routed to the screen's handlers, and Cmd+F reaching only the search bar of
// the screen in front. The native module and the focus hook are stand-ins.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

type Listener = (event: { id: string }) => void;
const mockListeners: Listener[] = [];
const mockRemove = jest.fn();
const mockSetCommands = jest.fn();

jest.mock("../../modules/hardware-keys", () => ({
	HardwareKeys: {
		setCommands: (commands: unknown) => mockSetCommands(commands),
		addListener: (_event: string, listener: Listener) => {
			mockListeners.push(listener);
			return { remove: mockRemove };
		},
	},
}));
jest.mock("expo-router", () => ({
	useFocusEffect: (effect: () => void) =>
		require("react").useEffect(effect, [effect]),
}));

const TITLES = { add: "Add expense", search: "Search" };

function Probe(props: Parameters<typeof useHardwareKeys>[1]) {
	useHardwareKeys(TITLES, props);
	return null;
}

describe("commandsFor", () => {
	it("is Cmd+N for add and Cmd+F for search, titled for the overlay", () => {
		expect(commandsFor(TITLES)).toEqual([
			{ id: "add", input: "n", title: "Add expense" },
			{ id: "search", input: "f", title: "Search" },
		]);
	});
});

describe("useHardwareKeys", () => {
	beforeEach(() => {
		mockListeners.length = 0;
		jest.clearAllMocks();
	});

	it("registers the commands and routes each key to its handler", () => {
		const add = jest.fn();
		const search = jest.fn();
		act(() => {
			create(<Probe add={add} search={search} />);
		});
		expect(mockSetCommands).toHaveBeenCalledWith(commandsFor(TITLES));
		act(() => mockListeners[0]?.({ id: "add" }));
		expect(add).toHaveBeenCalledTimes(1);
		expect(search).not.toHaveBeenCalled();
		act(() => mockListeners[0]?.({ id: "search" }));
		expect(search).toHaveBeenCalledTimes(1);
	});

	it("calls the newest handler without registering again", () => {
		const first = jest.fn();
		const second = jest.fn();
		let tree: { update(element: unknown): void } | undefined;
		act(() => {
			tree = create(<Probe add={first} search={jest.fn()} />);
		});
		act(() => tree?.update(<Probe add={second} search={jest.fn()} />));
		act(() => mockListeners[0]?.({ id: "add" }));
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
		expect(mockSetCommands).toHaveBeenCalledTimes(1);
	});

	it("stops listening on unmount and ignores unknown commands", () => {
		const add = jest.fn();
		let tree: { unmount(): void } | undefined;
		act(() => {
			tree = create(<Probe add={add} search={jest.fn()} />);
		});
		act(() => mockListeners[0]?.({ id: "other" }));
		expect(add).not.toHaveBeenCalled();
		act(() => tree?.unmount());
		expect(mockRemove).toHaveBeenCalledTimes(1);
	});
});

describe("focusSearch", () => {
	function Screen({ owner = true, bar }: { owner?: boolean; bar: object }) {
		const { useSearchShortcut } = require("./searchShortcut");
		const ref = useSearchShortcut(owner);
		ref.current = bar;
		return null;
	}

	it("focuses the search bar of the screen in front, and of no other", () => {
		const { focusSearch } = require("./searchShortcut");
		const a = { focus: jest.fn() };
		const b = { focus: jest.fn() };
		expect(focusSearch()).toBe(false);
		let one: { unmount(): void } | undefined;
		act(() => {
			one = create(<Screen bar={a} />);
		});
		expect(focusSearch()).toBe(true);
		expect(a.focus).toHaveBeenCalledTimes(1);
		act(() => one?.unmount());
		expect(focusSearch()).toBe(false);
		act(() => {
			create(<Screen bar={b} />);
		});
		focusSearch();
		expect(b.focus).toHaveBeenCalledTimes(1);
		expect(a.focus).toHaveBeenCalledTimes(1);
	});

	it("leaves the key to the hub when a list inside it is not the owner", () => {
		const { focusSearch } = require("./searchShortcut");
		const hub = { focus: jest.fn() };
		const list = { focus: jest.fn() };
		act(() => {
			create(
				<>
					<Screen bar={hub} />
					<Screen bar={list} owner={false} />
				</>,
			);
		});
		focusSearch();
		expect(hub.focus).toHaveBeenCalledTimes(1);
		expect(list.focus).not.toHaveBeenCalled();
	});
});
