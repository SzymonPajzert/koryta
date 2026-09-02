import { z } from "zod";

/** Daily games roll over at midnight Polish time. */
export function warsawToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
}

export const gameDateValidator = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
