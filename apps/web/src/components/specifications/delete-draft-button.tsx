"use client";

import { useActionState } from "react";
import { type DraftActionState, deleteSpecificationDraft } from "@/app/admin/specification-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteDraftButton({
  organizationId,
  draftId,
  name,
  redirectToList = false,
}: {
  organizationId: string;
  draftId: string;
  name: string;
  redirectToList?: boolean;
}) {
  const [state, remove, pending] = useActionState<DraftActionState, FormData>(
    deleteSpecificationDraft,
    {},
  );
  return (
    <ConfirmDialog
      trigger="Delete draft"
      title={`Delete “${name}”?`}
      description="The draft and its unpublished changes are deleted. Published versions are not affected. You cannot undo this."
      confirmLabel="Delete draft"
      pendingLabel="Deleting…"
      cancelLabel="Keep draft"
      action={remove}
      pending={pending}
      error={state.error}
      fields={{
        organizationId,
        draftId,
        ...(redirectToList ? { redirect: "list" } : {}),
      }}
    />
  );
}
