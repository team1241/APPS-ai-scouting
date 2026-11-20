"use client";

import {
  Alert,
  Button,
  Checkbox,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { type ApplicationState, submitApplication } from "@/app/request-access/actions";
import { LinkButton } from "@/components/link-button";

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
const inputClass = "md:text-base";

// TanStack exposes schema issues and server strings through the same field metadata.
function fieldErrors(errors: unknown[]) {
  const messages = errors
    .map((error) =>
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : undefined,
    )
    .filter((message): message is string => Boolean(message));
  return [...new Set(messages)].join(" ");
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
        formElement.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] button')
          ?.focus(),
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
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-8"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 48 48"
          fill="none"
          className="size-12 text-bumper-deep"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="24" cy="24" r="22" fill="var(--sky)" />
          <path d="M15 24.5l6 6 12-13" stroke="currentColor" strokeWidth="3.5" />
        </svg>
        <h2 className="font-display mt-5 text-2xl">Application received</h2>
        <p className="mt-3 text-muted">
          Thank you for requesting access. Your application is saved and pending review by an
          application owner or administrator.
        </p>
        <p className="mt-3 text-muted">
          Submitting an application does not grant access. No confirmation email has been sent.
        </p>
        <LinkButton href="/" variant="outline" className="mt-6">
          Return home
        </LinkButton>
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
          className="mb-6 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{result.message}</Alert.Title>
              {result.errors.id ? <Alert.Description>{result.errors.id}</Alert.Description> : null}
            </Alert.Content>
          </Alert>
        </div>
      ) : null}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <fieldset disabled={isSubmitting} aria-busy={isSubmitting} className="min-w-0">
            <legend className="sr-only">Your access application. All fields are required.</legend>
            <div className="flex flex-col gap-6">
              <form.Field name="name">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <TextField
                      name={field.name}
                      autoComplete="name"
                      isRequired
                      maxLength={120}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      isInvalid={invalid}
                      isDisabled={isSubmitting}
                      validationBehavior="aria"
                      fullWidth
                    >
                      <Label>Your name</Label>
                      <Input className={inputClass} />
                      <FieldError>{fieldErrors(field.state.meta.errors)}</FieldError>
                    </TextField>
                  );
                }}
              </form.Field>
              <form.Field name="email">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <TextField
                      name={field.name}
                      type="email"
                      autoComplete="email"
                      isRequired
                      maxLength={254}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      isInvalid={invalid}
                      isDisabled={isSubmitting}
                      validationBehavior="aria"
                      fullWidth
                    >
                      <Label>Email address</Label>
                      <Input className={inputClass} />
                      <FieldError>{fieldErrors(field.state.meta.errors)}</FieldError>
                    </TextField>
                  );
                }}
              </form.Field>
              <form.Field name="teamNumber">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <TextField
                      name={field.name}
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,4}"
                      isRequired
                      value={field.state.value}
                      onChange={(value) => field.handleChange(value.replace(/\D/g, "").slice(0, 5))}
                      onBlur={field.handleBlur}
                      isInvalid={invalid}
                      isDisabled={isSubmitting}
                      validationBehavior="aria"
                      fullWidth
                    >
                      <Label>FRC team number</Label>
                      <Input className={`${inputClass} tabular-nums`} />
                      <Description>Use your team’s number, for example 1241.</Description>
                      <FieldError>{fieldErrors(field.state.meta.errors)}</FieldError>
                    </TextField>
                  );
                }}
              </form.Field>
              <form.Field name="role">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Select
                      name={field.name}
                      placeholder="Select your role"
                      value={field.state.value || null}
                      onChange={(value) => field.handleChange(value ? String(value) : "")}
                      onBlur={field.handleBlur}
                      isRequired
                      isInvalid={invalid}
                      isDisabled={isSubmitting}
                      validationBehavior="aria"
                      fullWidth
                    >
                      <Label>Role on the team</Label>
                      <Select.Trigger className="min-h-11">
                        <Select.Value className={inputClass} />
                        <Select.Indicator />
                      </Select.Trigger>
                      <FieldError>{fieldErrors(field.state.meta.errors)}</FieldError>
                      <Select.Popover>
                        <ListBox>
                          {roles.map((role) => (
                            <ListBox.Item
                              key={role.value}
                              id={role.value}
                              textValue={role.label}
                              className="min-h-11 text-base"
                            >
                              {role.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  );
                }}
              </form.Field>
              <form.Field name="adultAttested">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <div className="space-y-1.5">
                      <Checkbox
                        name={field.name}
                        isSelected={field.state.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        isRequired
                        isInvalid={invalid}
                        isDisabled={isSubmitting}
                        validationBehavior="aria"
                        aria-describedby={invalid ? "adultAttested-error" : undefined}
                      >
                        <Checkbox.Content className="min-h-11 items-start gap-3">
                          <Checkbox.Control className="mt-0.5 shrink-0">
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="leading-6">
                            I confirm that I am at least 18 years old and the age of majority where
                            I live.
                          </span>
                        </Checkbox.Content>
                      </Checkbox>
                      {invalid ? (
                        <p
                          id="adultAttested-error"
                          className="pl-8 text-sm font-medium text-danger"
                        >
                          {fieldErrors(field.state.meta.errors)}
                        </p>
                      ) : null}
                    </div>
                  );
                }}
              </form.Field>
              <p className="text-sm text-muted">
                We store these details so an application owner or administrator can review your
                request. See our{" "}
                <Link
                  href="/privacy"
                  className="rounded-sm font-medium text-foreground underline underline-offset-4"
                >
                  privacy notice
                </Link>
                .
              </p>
              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  size="lg"
                  isPending={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? "Submitting application…" : "Submit application"}
                </Button>
                <span role="status" className="sr-only">
                  {isSubmitting ? "Submitting your application. Please wait." : ""}
                </span>
              </div>
            </div>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  );
}
