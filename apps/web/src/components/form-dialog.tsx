"use client";

import { Modal } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The shared dialog panel for short forms (create key, invite, add operator,
// new specification, publish). Pass the form as children and end it with
// DialogActions. While pending, the dialog cannot be dismissed.
export function FormDialog({
  isOpen,
  onOpenChange,
  isPending = false,
  title,
  description,
  icon,
  size = "md",
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPending?: boolean;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(next) => (isPending ? null : onOpenChange(next))}
      isDismissable={!isPending}
    >
      <Modal.Container placement="auto">
        <Modal.Dialog className={size === "lg" ? "sm:max-w-xl" : "sm:max-w-md"}>
          {isPending ? null : <Modal.CloseTrigger />}
          <Modal.Header>
            {icon ? (
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">{icon}</Modal.Icon>
            ) : null}
            <Modal.Heading className="[overflow-wrap:anywhere]">{title}</Modal.Heading>
            {description ? (
              <p className="mt-1.5 text-sm text-pretty text-muted">{description}</p>
            ) : null}
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

// Footer row for a FormDialog's form: stacked on phones with the primary action on top.
export function DialogActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
