import { z } from "zod";

const textField = (maximum = 4000) => z.string().max(maximum);

const structuredPromptSchema = z.object({
  character: textField(),
  appearance: textField(),
  composition: textField(),
  situation: textField(),
  style: textField(),
  extra: textField()
}).partial().strict();

const completeStructuredPromptSchema = z.object({
  character: textField(),
  appearance: textField(),
  composition: textField(),
  situation: textField(),
  style: textField(),
  extra: textField()
}).strict();

const hiresSchema = z.object({
  enabled: z.boolean().optional(),
  scale: z.number().finite().min(1).max(2).optional(),
  steps: z.number().int().min(1).max(50).optional(),
  denoising: z.number().finite().min(0.1).max(0.8).optional(),
  upscaler: textField(200).optional()
}).strict();

const settingsSchema = z.object({
  checkpoint: textField(200).optional(),
  width: z.number().int().min(256).max(1536).multipleOf(64).optional(),
  height: z.number().int().min(256).max(1536).multipleOf(64).optional(),
  steps: z.number().int().min(1).max(80).optional(),
  cfgScale: z.number().finite().min(1).max(20).optional(),
  sampler: textField(100).optional(),
  scheduler: textField(100).optional(),
  noiseSchedule: textField(100).optional(),
  seed: z.number().int().min(-1).max(4294967295).optional(),
  candidateCount: z.number().int().min(1).max(4).optional(),
  hires: hiresSchema.nullable().optional()
}).strict();

const loraSchema = z.object({
  name: z.string().min(1).max(200),
  weight: z.number().finite().min(0.05).max(2).optional(),
  enabled: z.boolean().optional()
}).strict();

export const emptyInputSchema = z.object({}).strict().default({});

export const jobIdSchema = z.string()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/);

const runtimeIdSchema = z.string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const contentRatingSchema = z.enum(["general", "nsfw"]);
const historyRatingSchema = z.enum(["all", "general", "nsfw", "unrated"]);

export const capabilitiesInputSchema = z.object({
  runtimeId: runtimeIdSchema.optional()
}).strict().default({});

const ipAdapterSchema = z.object({
  referenceImageId: jobIdSchema,
  weight: z.number().finite().min(0).max(2).optional(),
  guidanceStart: z.number().finite().min(0).max(1).optional(),
  guidanceEnd: z.number().finite().min(0).max(1).optional()
}).strict().refine(
  ({ guidanceStart, guidanceEnd }) => (guidanceStart ?? 0) < (guidanceEnd ?? 1),
  { message: "guidanceStartはguidanceEndより小さくしてください", path: ["guidanceEnd"] }
);

export const generateImageInputSchema = z.object({
  mode: z.literal("txt2img").optional(),
  runtimeId: runtimeIdSchema.optional(),
  contentRating: contentRatingSchema.optional(),
  prompt: z.object({
    structured: structuredPromptSchema.nullable().optional(),
    rawOverride: z.string().max(12000).nullable().optional(),
    negative: z.string().max(12000).optional()
  }).strict(),
  settings: settingsSchema.optional(),
  loras: z.array(loraSchema).max(8).optional(),
  ipAdapter: ipAdapterSchema.optional()
}).strict();

export const jobInputSchema = z.object({
  id: jobIdSchema
}).strict();

export const historyInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: jobIdSchema.optional(),
  favorites: z.boolean().optional(),
  rating: historyRatingSchema.optional()
}).strict();

export const imageInputSchema = z.object({
  imageId: jobIdSchema
}).strict();

export const importReferenceImageInputSchema = z.object({
  attachmentPath: z.string().min(1).max(4096)
}).strict();

export const historyItemInputSchema = z.object({
  id: jobIdSchema
}).strict();

export const regenerateImageInputSchema = z.object({
  historyId: jobIdSchema,
  sourceImageId: jobIdSchema,
  runtimeId: runtimeIdSchema.optional(),
  contentRating: contentRatingSchema.optional(),
  prompt: z.object({
    structured: completeStructuredPromptSchema.nullable().optional(),
    rawOverride: z.string().max(12000).nullable().optional(),
    negative: z.string().max(12000).optional()
  }).strict().optional(),
  settings: settingsSchema.optional(),
  loras: z.array(loraSchema).max(8).optional(),
  ipAdapter: ipAdapterSchema.optional(),
  reuseSeed: z.boolean().optional(),
  instruction: z.string().max(500).optional()
}).strict();
