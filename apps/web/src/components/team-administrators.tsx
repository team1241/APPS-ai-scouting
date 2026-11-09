"use client";

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
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

const initialInvite: InviteAdminState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

// Radix unmounts this form when the dialog closes, so each open starts empty.
function InviteForm({
  organizationId,
  onDone,
  onPendingChange,
}: {
  organizationId: string;
  onDone: (message: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, submit, pending] = useActionState(inviteAdministrator, initialInvite);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status === "done" && state.message) onDone(state.message);
    if (state.status === "error")
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [state, onDone]);
  const field = (name: "name" | "email", label: string, type: string) => {
    const error = state.errors[name];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`admin-${name}`}>{label}</Label>
        <Input
          id={`admin-${name}`}
          name={name}
          type={type}
          required
          maxLength={name === "name" ? 120 : 254}
          autoComplete="off"
          defaultValue={state.values[name]}
          key={`${name}-${state.status}-${state.values[name]}`}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `admin-${name}-error` : undefined}
          className="h-11"
        />
        {error ? (
          <p id={`admin-${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  };
  const attestError = state.errors.adultAttested;
  return (
    <form ref={form} action={submit} className="grid gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <DialogHeader>
        <DialogTitle>Invite administrator</DialogTitle>
        <DialogDescription>
          If they already have an account, they accept from Teams the next time they sign in.
          Otherwise we email them an invitation. Invitations expire after 7 days.
        </DialogDescription>
      </DialogHeader>
      {field("name", "Name", "text")}
      {field("email", "Email", "email")}
      <div className="flex gap-3">
        <div className="flex h-6 shrink-0 items-center">
          <Checkbox
            id="admin-adultAttested"
            name="adultAttested"
            required
            disabled={pending}
            aria-invalid={attestError ? true : undefined}
            aria-describedby={attestError ? "admin-adultAttested-error" : undefined}
            className="shadow-none"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-adultAttested" className="cursor-pointer font-normal leading-6">
            I confirm this person is at least 18 and the age of majority where they live, and is
            authorized to administer this team.
          </Label>
          {attestError ? (
            <p id="admin-adultAttested-error" className="text-sm text-destructive">
              {attestError}
            </p>
          ) : null}
        </div>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending} className="h-11">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Inviting…" : "Send invitation"}
        </Button>
      </DialogFooter>
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
    <Dialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
      <DialogTrigger asChild>
        <Button type="button" className="h-11 px-5">
          <UserPlus aria-hidden="true" />
          Invite administrator
        </Button>
      </DialogTrigger>
      <DialogContent>
        <InviteForm organizationId={organizationId} onDone={done} onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
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
    <li className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-medium [overflow-wrap:anywhere]">{invitation.name}</p>
          {invitation.existingAccount ? (
            <StatusBadge tone="waiting">Waiting to accept</StatusBadge>
          ) : invitation.sent ? (
            <StatusBadge tone="waiting">Email sent</StatusBadge>
          ) : (
            <StatusBadge tone="danger">Email not sent</StatusBadge>
          )}
        </div>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{invitation.email}</p>
        <p className="text-sm text-muted-foreground">
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
              <Button type="submit" variant="outline" disabled={busy} className="h-11">
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
              resent.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
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
    <section className="rounded-xl border bg-card" aria-labelledby="administrators-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="administrators-title" className="text-lg font-semibold">
            Administrators
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Adults who manage this team’s Telegram connection, API keys and administrators. Each
            signs in with their own account.
          </p>
        </div>
        {data ? <InviteDialog organizationId={organizationId} onDone={setNotice} /> : null}
      </div>
      <p role="status" className="px-6 pb-4 text-sm text-success empty:hidden">
        {notice}
      </p>
      {data === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm">We couldn’t load your team’s administrators.</p>
          <Button type="button" variant="outline" className="h-11" onClick={() => router.refresh()}>
            Check again
          </Button>
        </div>
      ) : (
        <>
          <ul className="divide-y border-t">
            {data.administrators.map((admin) => (
              <li
                key={admin.memberId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">{admin.name}</p>
                  <p className="text-sm text-muted-foreground">
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
              <h3 className="border-t px-6 pt-5 pb-1 text-sm font-semibold">Invited</h3>
              <ul className="divide-y">
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
        </>
      )}
    </section>
  );
}
