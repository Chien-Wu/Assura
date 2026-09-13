import type { ShiftFields } from "@/lib/notes/form";
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));

export const hasContent = (fields: ShiftFields) =>
  Object.entries(fields).some(
    ([key, value]) =>
      value &&
      !((key === "incidents" || key === "followUp") && value === "unanswered"),
  );
