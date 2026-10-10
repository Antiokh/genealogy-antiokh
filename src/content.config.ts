import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const looseDate = z.object({
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  circa: z.boolean().optional(),
  text: z.string().optional(),
}).passthrough();

const structuredName = z.object({
  first: z.string().optional(),
  patronymic: z.string().optional(),
  last: z.string().optional(),
  birthLast: z.string().optional(),
  aliases: z.array(z.string()).optional(),
}).passthrough();

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        entity: z.enum([
          'index',
          'person',
          'event',
          'place',
          'source',
          'citation',
          'evidence',
        ]).optional(),
        id: z.string().optional(),
        name: z.union([z.string(), structuredName]).optional(),
        sex: z.enum(['M', 'F', 'X', 'U']).optional(),
        birth: looseDate.optional(),
        death: looseDate.optional(),
        date: looseDate.optional(),
        parents: z.array(z.string()).optional(),
        partners: z.array(z.string()).optional(),
        participants: z.array(z.string()).optional(),
        places: z.array(z.string()).optional(),
        sources: z.array(z.string()).optional(),
        external: z.record(z.string(), z.unknown()).optional(),
      }),
    }),
  }),
};
