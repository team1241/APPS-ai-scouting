"use client";

import { revalidateLogic, useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { type ApplicationState, submitApplication } from "@/app/request-access/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roles = [
  { value: "mentor", label: "Mentor" },
  { value: "lead_mentor", label: "Lead mentor" },
  { value: "teacher", label: "Teacher" },
  { value: "other", label: "Other" },
];
const applicationSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120, "Use 120 characters or fewer."),
  email: z
    .string()
    .trim()
    .max(254, "Use 254 characters or fewer.")
    .email("Enter a valid email address."),
  teamNumber: z.string().regex(/^[1-9]\d{0,4}$/, "Enter a team number from 1 to 99999."),
  role: z
    .string()
    .refine((value) => roles.some((role) => role.value === value), "Choose your role on the team."),
  adultAttested: z.boolean().refine((value) => value, "Confirm that you meet the age requirement."),
});
const initialState: ApplicationState = { status: "idle", values: {}, errors: {} };
const inputClass = "min-h-11 bg-card shadow-none md:text-base";

// TanStack exposes schema issues and server strings through the same field metadata.
function fieldErrors(errors: unknown[]) {
  return errors.map((error) => ({
    message:
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : undefined,
  }));
}

export function AccessApplicationForm({ requestId }: { requestId: string }) {
  const [result, setResult] = useState(initialState);
  const feedback = useRef<HTMLDivElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: { name: "", email: "", teamNumber: "", role: "", adultAttested: false },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: applicationSchema },
    listeners: {
      onChange: ({ fieldApi }) => fieldApi.setErrorMap({ onServer: undefined }),
    },
    onSubmitInvalid: () => {
      requestAnimationFrame(() =>
        formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    },
    onSubmit: async ({ value, formApi }) => {
      setResult(initialState);
      const data = new FormData();
      data.set("id", requestId);
      for (const [name, entry] of Object.entries(value)) {
        data.set(name, typeof entry === "boolean" ? (entry ? "on" : "") : entry);
      }
      let response: ApplicationState;
      try {
        response = await submitApplication(initialState, data);
      } catch {
        response = {
          ...initialState,
          status: "error",
          message:
            "We couldn’t confirm your submission. Your details are still here. Please try again.",
        };
      }
      for (const name of ["name", "email", "teamNumber", "role", "adultAttested"] as const) {
        if (response.errors[name]) {
          formApi.setFieldMeta(name, (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: response.errors[name] },
          }));
        }
      }
      setResult(response);
    },
  });
  useEffect(() => {
    if (result.status !== "idle") feedback.current?.focus();
  }, [result]);

  if (result.status === "received")
    return (
      <div
        ref={feedback}
        tabIndex={-1}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-8"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 48 48"
          fill="none"
          className="size-12 text-navy"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="24" cy="24" r="22" fill="var(--sky)" />
          <path d="M15 24.5l6 6 12-13" stroke="currentColor" strokeWidth="3.5" />
        </svg>
        <h2 className="mt-5 text-2xl font-extrabold font-stretch-125% tracking-[-0.02em]">
          Application received
        </h2>
        <p className="mt-3 text-muted-foreground">
          Thank you for requesting access. Your application is saved and pending review by an
          application owner or administrator.
        </p>
        <p className="mt-3 text-muted-foreground">
          Submitting an application does not grant access. No confirmation email has been sent.
        </p>
        <Button asChild variant="outline" className="mt-6 min-h-11 shadow-none">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    );

  return (
    <form
      ref={formElement}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {result.status === "error" ? (
        <div
          ref={feedback}
          tabIndex={-1}
          role="alert"
          className="mb-6 rounded-md border border-destructive p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="font-medium">{result.message}</p>
          {result.errors.id ? <p className="mt-2">{result.errors.id}</p> : null}
        </div>
      ) : null}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <FieldSet disabled={isSubmitting} aria-busy={isSubmitting}>
            <FieldLegend className="sr-only">
              Your access application. All fields are required.
            </FieldLegend>
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>Your name</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        autoComplete="name"
                        required
                        maxLength={120}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? "name-error" : undefined}
                        className={inputClass}
                      />
                      {invalid ? (
                        <FieldError id="name-error" errors={fieldErrors(field.state.meta.errors)} />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="email">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>Email address</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? "email-error" : undefined}
                        className={inputClass}
                      />
                      {invalid ? (
                        <FieldError
                          id="email-error"
                          errors={fieldErrors(field.state.meta.errors)}
                        />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="teamNumber">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>FRC team number</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        inputMode="numeric"
                        pattern="[1-9][0-9]{0,4}"
                        required
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value.replace(/\D/g, "").slice(0, 5))
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={`teamNumber-hint${invalid ? " teamNumber-error" : ""}`}
                        className={inputClass}
                      />
                      <FieldDescription id="teamNumber-hint">
                        Use your team’s number, for example 1241.
                      </FieldDescription>
                      {invalid ? (
                        <FieldError
                          id="teamNumber-error"
                          errors={fieldErrors(field.state.meta.errors)}
                        />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="role">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={field.name}>Role on the team</FieldLabel>
                      <Select
                        name={field.name}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        required
                        disabled={isSubmitting}
                      >
                        <SelectTrigger
                          id={field.name}
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? "role-error" : undefined}
                          className="min-h-11 w-full bg-card text-base shadow-none"
                        >
                          <SelectValue placeholder="Select your role" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {roles.map((role) => (
                            <SelectItem
                              key={role.value}
                              value={role.value}
                              className="min-h-11 text-base"
                            >
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {invalid ? (
                        <FieldError id="role-error" errors={fieldErrors(field.state.meta.errors)} />
                      ) : null}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="adultAttested">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid} orientation="horizontal">
                      <div className="flex h-6 shrink-0 items-center">
                        <Checkbox
                          id={field.name}
                          name={field.name}
                          checked={field.state.value}
                          onCheckedChange={(checked) => field.handleChange(checked === true)}
                          onBlur={field.handleBlur}
                          required
                          disabled={isSubmitting}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? "adultAttested-error" : undefined}
                          className="shadow-none"
                        />
                      </div>
                      <FieldContent>
                        <FieldLabel
                          htmlFor={field.name}
                          className="min-h-11 cursor-pointer items-start font-normal leading-6"
                        >
                          I confirm that I am at least 18 years old and the age of majority where I
                          live.
                        </FieldLabel>
                        {invalid ? (
                          <FieldError
                            id="adultAttested-error"
                            errors={fieldErrors(field.state.meta.errors)}
                          />
                        ) : null}
                      </FieldContent>
                    </Field>
                  );
                }}
              </form.Field>
              <FieldDescription>
                We store these details so an application owner or administrator can review your
                request. See our{" "}
                <Link href="/privacy" className="rounded-sm text-foreground">
                  privacy notice
                </Link>
                .
              </FieldDescription>
              <Field orientation="horizontal">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-12 w-full bg-navy px-6 text-base font-semibold shadow-none hover:bg-navy-raised sm:w-auto"
                >
                  {isSubmitting ? "Submitting application…" : "Submit application"}
                </Button>
                <span role="status" className="sr-only">
                  {isSubmitting ? "Submitting your application. Please wait." : ""}
                </span>
              </Field>
            </FieldGroup>
          </FieldSet>
        )}
      </form.Subscribe>
    </form>
  );
}
