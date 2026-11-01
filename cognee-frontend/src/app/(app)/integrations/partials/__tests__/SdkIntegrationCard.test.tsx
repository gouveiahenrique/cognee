import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { googleApi } from "@/modules/integrations/googleApi";
import type { ConnectorProvider } from "@/modules/integrations/sdkConnectorApi";
import SdkIntegrationCard from "../SdkIntegrationCard";

// connectorApi delegates to googleApi (same routes), so mocking googleApi
// covers both and lets the tests assert the provider reaching the route.
jest.mock("@/modules/integrations/googleApi", () => ({
  ...jest.requireActual("@/modules/integrations/googleApi"),
  googleApi: { connection: jest.fn(), resources: jest.fn(), authorize: jest.fn(), select: jest.fn(), sync: jest.fn(), disconnect: jest.fn() },
}));
jest.mock("@/ui/elements/ModalShell", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));

const api = jest.mocked(googleApi);
const connected = { connected: true, account_label: "tester@example.com", sync_status: "ok", last_synced_at: null };

beforeEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() });
  api.connection.mockResolvedValue(connected);
  api.resources.mockResolvedValue({ resources: [], selected: null });
  api.select.mockImplementation(async (_provider, ids) => ({ selected: ids }));
  api.sync.mockResolvedValue({ accepted: true });
  api.disconnect.mockResolvedValue({ disconnected: true });
});

function Harness({ provider }: { provider: ConnectorProvider }) {
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null);
  return <SdkIntegrationCard provider={provider} connecting={connecting} setConnecting={setConnecting} />;
}
function show(provider: ConnectorProvider) {
  return render(<MantineProvider><Harness provider={provider} /></MantineProvider>);
}

test("GitHub has no picker: repositories are chosen on GitHub, and sync needs no selection", async () => {
  api.connection.mockResolvedValue({ connected: true, account_label: "octo-org", sync_status: "ok", last_synced_at: null });
  const { container } = show("github");
  fireEvent.click(await screen.findByRole("button", { name: "Manage GitHub" }));
  expect(await screen.findByText("octo-org")).toBeInTheDocument();
  const sections = Array.from(container.querySelectorAll("section")).map(s => s.getAttribute("aria-label"));
  expect(sections).toEqual(["Sync status", "Account actions"]);
  expect(api.resources).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText(/Sync started/)).toBeInTheDocument();
  expect(api.sync).toHaveBeenCalledWith("github");
});

test("GitHub disconnect offers no dataset deletion the backend would refuse", async () => {
  show("github");
  fireEvent.click(await screen.findByRole("button", { name: "Manage GitHub" }));
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  expect(screen.queryByLabelText("Also delete this account’s imported Cognee dataset")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith("github", false));
});

test("GitHub authorization only navigates the popup to github.com", async () => {
  api.connection.mockResolvedValue({ connected: false });
  api.authorize.mockResolvedValue({ authorize_url: "https://accounts.google.com/o/oauth2/auth" });
  const popup = { closed: false, close: jest.fn(), location: { href: "" } };
  jest.spyOn(window, "open").mockReturnValueOnce(popup as unknown as Window);
  show("github");
  fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
  expect(await screen.findByText(/unexpected GitHub authorization URL/)).toBeInTheDocument();
  expect(popup.location.href).toBe("");
  expect(popup.close).toHaveBeenCalled();
});

test("Linear picks teams, all of them by default", async () => {
  api.resources.mockResolvedValue({ resources: [{ id: "t1", name: "Platform", selected: true }], selected: null });
  show("linear");
  fireEvent.click(await screen.findByRole("button", { name: "Manage Linear" }));
  expect(await screen.findByText("Choose teams")).toBeInTheDocument();
  expect(screen.getByLabelText("All teams")).toBeChecked();
  expect(api.resources).toHaveBeenCalledWith("linear");
});

test("Linear configuration error names Linear sign-in", async () => {
  api.connection.mockResolvedValue({ connected: false });
  api.authorize.mockRejectedValue(new Error("linear integration is not configured on this server."));
  jest.spyOn(window, "open").mockReturnValueOnce({ close: jest.fn() } as unknown as Window);
  show("linear");
  fireEvent.click(await screen.findByRole("button", { name: "Connect Linear" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with Linear" }));
  expect(await screen.findByText(/not been configured for Linear sign-in/)).toBeInTheDocument();
});

