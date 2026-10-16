import fetchMock from "jest-fetch-mock";
import createApiKey from "../createAPIKey";
import deleteApiKey from "../deleteAPIKey";
import getApiKeys from "../getApiKeys";

jest.mock("@/modules/users/getLocalApiUrl", () => ({ getLocalApiUrl: () => "http://localhost:8000" }));

beforeEach(() => fetchMock.resetMocks());

test("lists keys with browser session credentials", async () => {
  const keys = [{ id: "key-1", key: "************", label: "Local", name: "Local" }];
  fetchMock.mockResponseOnce(JSON.stringify(keys));

  await expect(getApiKeys()).resolves.toEqual(keys);
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8000/api/v1/auth/api-keys",
    expect.objectContaining({ credentials: "include" }),
  );
});

test("creates a named key and returns its one-time secret", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ id: "key-1", key: "cognee_secret" }));

  await expect(createApiKey({ name: "MCP" })).resolves.toEqual({
    ok: true,
    key: { id: "key-1", key: "cognee_secret" },
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8000/api/v1/auth/api-keys",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "MCP" }),
      credentials: "include",
    }),
  );
});

test("reports API errors in the create result", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ detail: "API key limit reached" }), { status: 400 });

  await expect(createApiKey({ name: "MCP" })).resolves.toEqual({
    ok: false,
    error: expect.stringContaining("API key limit reached"),
  });
});

test("deletes a key through the local API and includes credentials", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ deleted: true }));

  await expect(deleteApiKey("key/1")).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8000/api/v1/auth/api-keys/key%2F1",
    expect.objectContaining({ method: "DELETE", credentials: "include" }),
  );
});

test("rejects list and delete failures", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ detail: "key listing failed" }), { status: 500 });
  await expect(getApiKeys()).rejects.toThrow("key listing failed");

  fetchMock.mockResponseOnce(JSON.stringify({ detail: "key not found" }), { status: 404 });
  await expect(deleteApiKey("missing")).rejects.toThrow("key not found");
});
