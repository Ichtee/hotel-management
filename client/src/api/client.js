export async function api(path, { body, method = "GET", signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    signal,
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await res
    .json()
    .catch(() => ({
      error: { message: "The server returned an unexpected response." },
    }));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    const error = new Error(
      result.error?.message || "Request failed. Please try again.",
    );
    error.fields = result.error?.fields;
    error.status = res.status;
    throw error;
  }
  return result;
}
export const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value || 0);
export const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "Not set";
export const inputDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
        new Date(value),
      )
    : "";
