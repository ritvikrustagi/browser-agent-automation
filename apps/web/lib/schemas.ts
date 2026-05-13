import { z } from "zod";

export const pageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  elements: z.array(
    z.object({
      ref: z.string(),
      tag: z.string(),
      text: z.string().optional(),
      type: z.string().optional(),
      href: z.string().optional(),
      role: z.string().optional(),
    }),
  ),
});

export const agentStepBodySchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  pageSnapshot: pageSnapshotSchema,
  toolResults: z
    .array(
      z.object({
        tool_call_id: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  screenshots: z
    .array(
      z.object({
        tool_call_id: z.string(),
        dataUrl: z.string().startsWith("data:image/"),
      }),
    )
    .optional(),
});

export const sessionBodySchema = z.object({
  email: z.string().email(),
});

export const taskCreateSchema = z.object({
  userId: z.string().uuid(),
  prompt: z.string().min(1).max(8000),
});
