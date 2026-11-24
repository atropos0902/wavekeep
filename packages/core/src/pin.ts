import { z } from "zod";

/** The four things that identify a number. They travel in the URL and form the cache key. */
export const PinSchema = z.object({
  wave: z.coerce.number().int().positive(),
  questions: z.coerce.number().int().positive(),
  names: z.coerce.number().int().positive(),
  detector: z.coerce.number().int().positive(),
});
export type Pin = z.infer<typeof PinSchema>;

export const pinKey = (p: Pin): string => `${p.wave}.${p.questions}.${p.names}.${p.detector}`;

export function parsePin(text: string): Pin | null {
  const m = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(text);
  if (!m) return null;
  const parsed = PinSchema.safeParse({ wave: m[1], questions: m[2], names: m[3], detector: m[4] });
  return parsed.success ? parsed.data : null;
}
