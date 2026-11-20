"use client";

import { Button, Card, Checkbox, FieldError, Input, Label, TextField } from "@heroui/react";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  type AdminInvitationState,
  cancelAdministratorInvitation,
  type InviteAdminState,
  inviteAdministrator,
  resendAdministratorInvitation,
} from "@/app/admin/administrator-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DialogActions, FormDialog } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { useEditedErrors } from "@/lib/use-edited-errors";

export interface TeamAdmin {
  memberId: string;
  name: string;
  linked: boolean;
  isSelf: boolean;
  approvedAt: string;
}

export interface AdminInvitation {
  id: string;
  name: string;
  email: string;
  existingAccount: boolean;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  sent: boolean;
}

// A full-width divider between a card's sections.
const cardDivider = "-mx-5 border-t border-separator sm:-mx-6";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

const initialInvite: InviteAdminState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

// The dialog unmounts this form when it closes, so each open starts empty.
function InviteForm({
  organizationId,
  onDone,
  onPendingChange,
  onCancel,
}: {
  organizationId: string;
  onDone: (message: string) => void;
  onPendingChange: (pending: boolean) => void;
  onCancel: () => void;
}) {
  const [state, submit, pending] = useActionState(inviteAdministrator, initialInvite);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status === "done" && state.message) onDone(state.message);
    if (state.status === "error")
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [state, onDone]);
  const { edit, shown } = useEditedErrors<"name" | "email" | "adultAttested">(state);
  const field = (name: "name" | "email", label: string, type: string) => {
    const error = shown(name, state.errors[name]);
    return (
      <TextField
        key={`${name}-${state.status}-${state.values[name]}`}
        name={name}
        type={type}
        isRequired
        maxLength={name === "name" ? 120 : 254}
        autoComplete="off"
        defaultValue={state.values[name]}
        isDisabled={pending}
        isInvalid={Boolean(error)}
        onChange={() => edit(name)}
        fullWidth
      >
        <Label>{label}</Label>
        <Input />
        <FieldError>{error}</FieldError>
      </TextField>
    );
  };
  const attestError = shown("adultAttested", state.errors.adultAttested);
  return (
    <form ref={form} action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      {field("name", "Name", "text")}
      {field("email", "Email", "email")}
      <div className="space-y-1.5">
        <Checkbox
          name="adultAttested"
          isRequired
          isDisabled={pending}
          isInvalid={Boolean(attestError)}
          onChange={() => edit("adultAttested")}
          aria-describedby={attestError ? "admin-adultAttested-error" : undefined}
        >
          <Checkbox.Content className="items-start gap-3">
            <Checkbox.Control className="mt-0.5 shrink-0">
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span className="text-sm leading-6">
              I confirm this person is at least 18 and the age of majority where they live, and is
              authorized to administer this team.
            </span>
          </Checkbox.Content>
        </Checkbox>
        {attestError ? (
          <p id="admin-adultAttested-error" className="pl-8 text-sm font-medium text-danger">
            {attestError}
          </p>
        ) : null}
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
      <DialogActions>
        <Button variant="tertiary" isDisabled={pending} onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={pending}>
          {pending ? "Inviting…" : "Send invitation"}
        </Button>
      </DialogActions>
    </form>
  );
}

function InviteDialog({
  organizationId,
  onDone,
}: {
  organizationId: string;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const done = (message: string) => {
    onDone(message);
    setOpen(false);
  };
  return (
    <>
      <Button onPress={() => setOpen(true)}>
        <UserPlus aria-hidden="true" className="size-4" />
        Invite administrator
      </Button>
      <FormDialog
        isOpen={open}
        onOpenChange={setOpen}
        isPending={pending}
        title="Invite administrator"
        description="If they already have an account, they accept from Teams the next time they sign in. Otherwise we email them an invitation. Invitations expire after 7 days."
        icon={<UserPlus aria-hidden="true" className="size-5" />}
      >
        <InviteForm
          organizationId={organizationId}
          onDone={done}
          onPendingChange={setPending}
          onCancel={() => setOpen(false)}
        />
      </FormDialog>
    </>
  );
}

function InvitationRow({
  organizationId,
  invitation,
}: {
  organizationId: string;
  invitation: AdminInvitation;
}) {
  const [resent, resend, resending] = useActionState<AdminInvitationState, FormData>(
    resendAdministratorInvitation,
    { status: "idle" },
  );
  const [cancelled, cancel, cancelling] = useActionState<AdminInvitationState, FormData>(
    cancelAdministratorInvitation,
    { status: "idle" },
  );
  const busy = resending || cancelling;
  const fields = { organizationId, invitationId: invitation.id };
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-semibold [overflow-wrap:anywhere]">{invitation.name}</p>
          {invitation.existingAccount ? (
            <StatusBadge tone="waiting">Waiting to accept</StatusBadge>
          ) : invitation.sent ? (
            <StatusBadge tone="waiting">Email sent</StatusBadge>
          ) : (
            <StatusBadge tone="danger">Email not sent</StatusBadge>
          )}
        </div>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">{invitation.email}</p>
        <p className="text-sm text-muted">
          Expires{" "}
          <time dateTime={invitation.expiresAt}>
            {dateFormat.format(new Date(invitation.expiresAt))}
          </time>
          {invitation.invitedByName ? ` · Invited by ${invitation.invitedByName}` : null}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {invitation.existingAccount ? null : (
            <form action={resend}>
              {Object.entries(fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" variant="outline" isDisabled={busy} isPending={resending}>
                {resending ? "Sending…" : "Resend"}
              </Button>
            </form>
          )}
          <ConfirmDialog
            trigger="Cancel invitation"
            title={`Cancel the invitation for ${invitation.name}?`}
            description={
              invitation.existingAccount
                ? "They can no longer accept it. You can invite them again later."
                : "The link in their email stops working. You can invite them again later."
            }
            confirmLabel="Cancel invitation"
            pendingLabel="Cancelling…"
            cancelLabel="Keep invitation"
            action={cancel}
            pending={cancelling}
            error={cancelled.status === "error" ? cancelled.message : undefined}
            disabled={busy}
            fields={fields}
          />
        </div>
        {resent.status !== "idle" && resent.message ? (
          <p
            role={resent.status === "error" ? "alert" : "status"}
            className={
              resent.status === "error" ? "text-sm font-medium text-danger" : "text-sm text-muted"
            }
          >
            {resent.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function TeamAdministrators({
  organizationId,
  data,
}: {
  organizationId: string;
  data: { administrators: TeamAdmin[]; invitations: AdminInvitation[] } | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  return (
    <Card aria-labelledby="administrators-title" render={(props) => <section {...props} />}>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-64">
          <Card.Title id="administrators-title" render={(props) => <h2 {...props} />}>
            Administrators
          </Card.Title>
          <Card.Description className="mt-1">
            Adults who manage this team’s Telegram connection, API keys and administrators. Each
            signs in with their own account.
          </Card.Description>
        </div>
        {data ? <InviteDialog organizationId={organizationId} onDone={setNotice} /> : null}
      </Card.Header>
      <p role="status" className="text-sm font-medium text-success-soft-foreground empty:hidden">
        {notice}
      </p>
      {data === null ? (
        <Card.Footer className={`${cardDivider} flex-wrap justify-between gap-3 px-5 pt-4 sm:px-6`}>
          <p className="text-sm">We couldn’t load your team’s administrators.</p>
          <Button variant="outline" onPress={() => router.refresh()}>
            Check again
          </Button>
        </Card.Footer>
      ) : (
        <div className={`${cardDivider} -mb-5 sm:-mb-6`}>
          <ul className="divide-y divide-separator">
            {data.administrators.map((admin) => (
              <li
                key={admin.memberId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="font-semibold [overflow-wrap:anywhere]">{admin.name}</p>
                  <p className="text-sm text-muted">
                    Approved{" "}
                    <time dateTime={admin.approvedAt}>
                      {dateFormat.format(new Date(admin.approvedAt))}
                    </time>
                  </p>
                </div>
                {admin.isSelf ? (
                  <StatusBadge tone="neutral">You</StatusBadge>
                ) : admin.linked ? null : (
                  <StatusBadge tone="neutral">Not signed in yet</StatusBadge>
                )}
              </li>
            ))}
          </ul>
          {data.invitations.length ? (
            <>
              <h3 className="border-t border-separator bg-surface-secondary px-5 py-2.5 text-sm font-semibold text-muted sm:px-6">
                Invited
              </h3>
              <ul className="divide-y divide-separator">
                {data.invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    organizationId={organizationId}
                    invitation={invitation}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
