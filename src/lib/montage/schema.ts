import { z } from "zod";

export const montageOptionsSchema = z.object({
  style: z.enum(["dynamic", "smooth", "cinema"]).default("dynamic"),
  length: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  sound: z.enum(["original", "music", "mute"]).default("original"),
  title: z.string().trim().max(40).default(""),
});
