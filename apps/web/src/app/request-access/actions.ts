"use server";

export interface ApplicationState {
  status: "idle" | "error" | "received";
  message?: string;
  errors: Record<string, string>;
  values: Record<string, string>;
}

export async function submitApplication(
  _previous: ApplicationState,
  formData: FormData,
): Promise<ApplicationState> {
  const value = (key: string) => {
    const input = formData.get(key);
    return typeof input === "string" ? input : "";
  };
  const values = Object.fromEntries(
    ["name", "email", "teamNumber", "role", "adultAttested"].map((key) => [key, value(key)]),
  );
  const failure: ApplicationState = {
    status: "error",
    values,
    errors: {},
    message: "We couldn’t confirm your submission. Your details are still here. Please try again.",
  };
  try {
    if (!process.env.BACKEND_URL) return failure;
    const url = new URL("/web/access-applications", process.env.BACKEND_URL);
    if (
      url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return failure;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        id: value("id"),
        adultAttested: value("adultAttested") === "on",
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 400) {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "errors" in data &&
        data.errors &&
        typeof data.errors === "object"
      ) {
        const errors = Object.fromEntries(
          Object.entries(data.errors).filter(
            ([key, message]) =>
              ["id", ...Object.keys(values)].includes(key) && typeof message === "string",
          ),
        ) as Record<string, string>;
        if (Object.keys(errors).length)
          return {
            status: "error",
            values,
            errors,
            message: "Check the highlighted details and submit again.",
          };
      }
    }
    if (response.status !== 202) return failure;
    const data = await response.json();
    if (data.received !== true) return failure;
    return { status: "received", values: {}, errors: {} };
  } catch {
    return failure;
  }
}
