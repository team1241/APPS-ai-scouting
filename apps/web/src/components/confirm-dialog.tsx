"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Confirms a destructive form action in a modal. The dialog stays open while
// the action runs, shows its error, and closes once it succeeds.
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  action,
  pending,
  error,
  disabled,
  fields,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  disabled?: boolean;
  fields: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !error) setOpen(false);
    wasPending.current = pending;
  }, [pending, error]);
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="h-11 text-destructive hover:text-destructive"
        >
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={action} className="grid gap-5">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" disabled={pending} className="h-11">
                {cancelLabel}
              </Button>
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending} className="h-11">
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
