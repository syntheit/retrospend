import { Alert } from "react-native";
import { useProjectActions } from "./useProjectActions";

// The project's overflow items: Edit, Add person, Share and Settings for Owners
// and Editors, Archive or Restore for Owners. Archive asks first, then archives and offers Undo,
// which restores.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockUpdate = jest.fn(async () => ({}));
const mockShow = jest.fn();

jest.mock("use-intl", () => ({
	useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: { projects: { update: mockUpdate } } }),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key" }));
jest.mock("@/ui/Toast", () => ({ useToast: () => ({ show: mockShow }) }));

type Page = Parameters<typeof useProjectActions>[0];

let out!: ReturnType<typeof useProjectActions>;

function Probe({ of }: { of: Page }) {
	out = useProjectActions(of, jest.fn());
	return null;
}

function items(of: Page) {
	act(() => {
		create(<Probe of={of} />);
	});
	return out;
}

const page = (patch: Partial<Page>): Page => ({
	id: "p1",
	name: "Lisbon",
	status: "ACTIVE",
	myRole: "ORGANIZER",
	...patch,
});

describe("project menu items", () => {
	beforeEach(() => {
		mockUpdate.mockClear();
		mockShow.mockClear();
	});

	it("gives an Owner Edit, Add person and Archive", () => {
		expect(items(page({})).items.map((i) => i.id)).toEqual([
			"edit-project",
			"add-person",
			"share-project",
			"project-settings",
			"archive-project",
		]);
	});

	it("gives an Owner Edit, Add person and Restore on an archived project", () => {
		expect(items(page({ status: "ARCHIVED" })).items.map((i) => i.id)).toEqual([
			"edit-project",
			"add-person",
			"share-project",
			"project-settings",
			"restore-project",
		]);
	});

	it("gives an Editor Edit, Add person, Share and Settings", () => {
		expect(items(page({ myRole: "EDITOR" })).items.map((i) => i.id)).toEqual([
			"edit-project",
			"add-person",
			"share-project",
			"project-settings",
		]);
	});

	it("opens the Share and Settings sheets from their items", () => {
		const menu = items(page({}));
		expect(menu.sharing).toBe(false);
		expect(menu.configuring).toBe(false);
		act(() => {
			menu.items.find((i) => i.id === "share-project")?.onPress();
		});
		expect(out.sharing).toBe(true);
		act(() => {
			out.items.find((i) => i.id === "project-settings")?.onPress();
		});
		expect(out.configuring).toBe(true);
		act(() => out.closeShare());
		expect(out.sharing).toBe(false);
	});

	it("gives a Contributor nothing", () => {
		expect(items(page({ myRole: "CONTRIBUTOR" })).items).toEqual([]);
	});

	it("asks before archiving, then archives and offers Undo that restores", async () => {
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		const archive = items(page({})).items.find(
			(i) => i.id === "archive-project",
		);
		archive?.onPress();
		expect(alert).toHaveBeenCalledTimes(1);
		expect(mockUpdate).not.toHaveBeenCalled();
		const buttons = alert.mock.calls[0]?.[2] ?? [];
		await act(async () => {
			await buttons.find((b) => b.style === "destructive")?.onPress?.();
		});
		expect(mockUpdate).toHaveBeenLastCalledWith(
			{ id: "p1", status: "ARCHIVED" },
			{ context: { idempotencyKey: "key" } },
		);
		const toast = mockShow.mock.calls.at(-1)?.[0];
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(mockUpdate).toHaveBeenLastCalledWith(
			{ id: "p1", status: "ACTIVE" },
			{ context: { idempotencyKey: "key" } },
		);
		alert.mockRestore();
	});
});
