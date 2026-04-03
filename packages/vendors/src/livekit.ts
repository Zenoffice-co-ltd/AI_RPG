import { z } from "zod";

export const liveKitConnectionDetailsSchema = z.object({
  roomUrl: z.string().min(1),
  roomToken: z.string().min(1),
});

export type LiveKitConnectionDetails = z.infer<
  typeof liveKitConnectionDetailsSchema
>;
