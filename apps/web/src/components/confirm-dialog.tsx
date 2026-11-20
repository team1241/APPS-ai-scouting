"use client";

import { AlertDialog, Button } from "@heroui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
    <>
      <Button
        variant="ghost"
        isDisabled={disabled}
        className="text-danger hover:bg-danger-soft"
        onPress={() => setOpen(true)}
      >
        {trigger}
      </Button>
      <AlertDialog.Backdrop
        isOpen={open}
        onOpenChange={(next) => (pending ? null : setOpen(next))}
        isDismissable={!pending}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <form action={action} className="contents">
              {Object.entries(fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>{title}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-pretty text-muted">{description}</p>
                {error ? (
                  <p role="alert" className="mt-3 text-sm font-medium text-danger">
                    {error}
                  </p>
                ) : null}
              </AlertDialog.Body>
              <AlertDialog.Footer className="max-sm:flex-col-reverse max-sm:items-stretch">
                <Button
                  variant="tertiary"
                  isDisabled={pending}
                  onPress={() => setOpen(false)}
                  autoFocus
                >
                  {cancelLabel}
                </Button>
                <Button type="submit" variant="danger" isPending={pending}>
                  {pending ? pendingLabel : confirmLabel}
                </Button>
              </AlertDialog.Footer>
            </form>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
