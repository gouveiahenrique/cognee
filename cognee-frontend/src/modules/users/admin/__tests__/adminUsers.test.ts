import fetchMock from "jest-fetch-mock";
import { changeOwnPassword, createUser, deleteUser, grantDatasets, listUsers } from "../adminUsers";
import getMyUserId from "@/modules/apiKeys/getMyUserId";

jest.mock("@/modules/users/getLocalApiUrl", () => ({ getLocalApiUrl: () => "http://localhost:8000" }));

beforeEach(() => fetchMock.resetMocks());

test("lists users from the admin endpoint", async () => {
  fetchMock.mockResponseOnce(JSON.stringify([{ id: "u1", email: "a@b.co" }]));
  await expect(listUsers()).resolves.toEqual([{ id: "u1", email: "a@b.co" }]);
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/v1/users/admin", expect.objectContaining({ credentials: "include" }));
});

test("creates a user with snake_case fields", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ id: "u2" }));
  await createUser({ email: "new@b.co", password: "secret123", isSuperuser: true });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8000/api/v1/users/admin",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@b.co", password: "secret123", is_superuser: true }) }),
  );
});

test("deletes and grants against the right routes", async () => {
  fetchMock.mockResponse("{}");
  await deleteUser("u 1");
  await grantDatasets("u1", "write", ["d1"]);
  expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/users/admin/u%201");
  expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8000/api/v1/permissions/datasets/u1?permission_name=write");
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify(["d1"]) });
});

test("changes the signed-in user's password through /users/me", async () => {
  fetchMock.mockResponseOnce("{}");
  await changeOwnPassword("newpass123");
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8000/api/v1/users/me",
    expect.objectContaining({ method: "PATCH", body: JSON.stringify({ password: "newpass123" }) }),
  );
});

test("reads the user id from /users/me", async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ id: "fd19" }));
  await expect(getMyUserId()).resolves.toBe("fd19");
});
