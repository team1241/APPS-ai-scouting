"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  addOperator,
  type OperatorFormState,
  type RemoveState,
  removeOperator,
} from "@/app/operator/operators/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialForm: OperatorFormState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "" },
};

export function AddOperatorForm() {
  const [state, submit, pending] = useActionState(addOperator, initialForm);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const first = form.current?.querySelector<HTMLInputElement>("[aria-invalid=true]");
    first?.focus();
  }, [state]);
  const field = (name: "name" | "email", label: string, type: string, hint?: string) => {
    const error = state.errors[name];
    return (
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={`operator-${name}`}>{label}</Label>
        <Input
          id={`operator-${name}`}
          name={name}
          type={type}
          required
          maxLength={name === "name" ? 120 : 254}
          autoComplete="off"
          defaultValue={state.values[name]}
          key={`${name}-${state.status}-${state.values[name]}`}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `operator-${name}-error` : hint ? `operator-${name}-hint` : undefined
          }
          className="h-11"
        />
        {error ? (
          <p id={`operator-${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={`operator-${name}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <form ref={form} action={submit} className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {field("name", "Name", "text")}
        {field("email", "Email", "email", "Must match their verified sign-in email.")}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11 px-5">
          {pending ? "Adding…" : "Add operator"}
        </Button>
        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

// Removal is confirmed in place; there is no modal.
export function RemoveOperator({ clerkUserId, name }: { clerkUserId: string; name: string }) {
  const [state, remove, removing] = useActionState<RemoveState, FormData>(removeOperator, {
    status: "idle",
  });
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={remove} className="flex flex-wrap items-center gap-2 sm:justify-end">
      <input type="hidden" name="clerkUserId" value={clerkUserId} />
      {confirming ? (
        <>
          <span className="text-sm">Remove {name}?</span>
          <Button type="submit" variant="destructive" disabled={removing} className="h-11">
            {removing ? "Removing…" : "Confirm remove"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={removing}
            className="h-11"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-destructive hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      )}
      {state.status === "error" ? (
        <p role="alert" className="w-full text-sm text-destructive sm:text-right">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
