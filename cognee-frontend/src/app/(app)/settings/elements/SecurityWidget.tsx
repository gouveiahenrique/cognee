"use client";

import { useState } from "react";
import { Button, Divider, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { tokens } from "@/ui/theme/tokens";
import { trackPageEvent } from "@/modules/analytics";
import isCloudEnvironment from "@/utils/isCloudEnvironment";
import { changeOwnPassword } from "@/modules/users/admin/adminUsers";

const MIN_PASSWORD_LENGTH = 8;

function LocalPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  async function submit() {
    setSaving(true);
    try {
      await changeOwnPassword(password);
      setPassword("");
      setConfirm("");
      notifications.show({ title: "Password changed", message: "Use the new password next time you sign in.", color: "green" });
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as { detail?: unknown })?.detail;
      notifications.show({ title: "Could not change password", message: typeof message === "string" ? message : "Something went wrong", color: "red" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="0.5rem" maw="22rem">
      <PasswordInput
        label="New password"
        description={`At least ${MIN_PASSWORD_LENGTH} characters`}
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        radius="0.5rem"
      />
      <PasswordInput
        label="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.currentTarget.value)}
        error={mismatch ? "Passwords do not match" : undefined}
        radius="0.5rem"
      />
      <Button
        onClick={submit}
        disabled={!valid}
        loading={saving}
        size="sm"
        radius="0.5rem"
        className="self-start"
      >
        Change password
      </Button>
    </Stack>
  );
}

export default function SecurityWidget() {
  const cloud = isCloudEnvironment();
  return (
    <Stack
      className="rounded-[0.5rem] px-[2rem] pt-[1.5rem] pb-[1.75rem] !gap-[0] flex-1"
      bg="white"
    >
      <Stack className="!gap-[0] mb-[1.375rem]">
        <Title size="h2" mb="0.125rem">
          Security
        </Title>
        <Text c={tokens.textMuted} size="lg">
          Manage your account security and session
        </Text>
      </Stack>
      <Stack gap="1.25rem">
        <Stack gap="0.25rem">
          <Text size="sm" fw={500}>
            Password
          </Text>
          {cloud ? (
            <Text size="sm" c={tokens.textMuted}>
              Your password is managed by your authentication provider.
            </Text>
          ) : (
            <LocalPasswordForm />
          )}
        </Stack>
        <Divider />
        <Stack gap="0.25rem">
          <Text size="sm" fw={500}>
            Session
          </Text>
          <Text size="sm" c={tokens.textMuted} mb="0.5rem">
            Sign out of your account on this device.
          </Text>
          <Button
            component="a"
            href={cloud ? "/api/signout" : "/api/local-signout"}
            variant="outline"
            color="gray"
            size="sm"
            radius="0.5rem"
            className="self-start"
            onClick={() => trackPageEvent({ pageName: "Settings", eventName: "sign_out" })}
          >
            Log out
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
