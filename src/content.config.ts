import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const looseDate = z.object({
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  circa: z.boolean().optional(),
  before: z.boolean().optional(),
  after: z.boolean().optional(),
  text: z.string().optional(),
}).passthrough();

const dateValue = z.union([
  z.string(),
  z.number().int(),
  looseDate,
]);

const lifeEvent = z.object({
  known: z.boolean().optional(),
  date: dateValue.nullish(),
  place: z.string().nullish(),
}).passthrough();

const structuredName = z.object({
  full: z.string().optional(),
  display: z.string().optional(),
  first: z.string().optional(),
  middle: z.string().optional(),
  patronymic: z.string().optional(),
  last: z.string().optional(),
  birth_last: z.string().optional(),
  married_last: z.string().optional(),
  aliases: z.array(z.string()).optional(),
}).passthrough();

const partner = z.union([
  z.string(),
  z.object({
    person: z.string(),
    married: lifeEvent.optional(),
    divorced: lifeEvent.optional(),
  }).passthrough(),
]);

const residence = z.object({
  place: z.string(),
  from: dateValue.nullish(),
  to: dateValue.nullish(),
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
        importManaged: z.boolean().optional(),

        // Canonical person fields.
        name: z.union([z.string(), structuredName]).optional(),
        sex: z.enum(['M', 'F', 'X', 'U']).optional(),
        photo: z.string().optional(),
        father: z.string().nullish(),
        mother: z.string().nullish(),
        parents: z.array(z.string()).optional(),
        partners: z.array(partner).optional(),
        born: lifeEvent.optional(),
        died: lifeEvent.optional(),
        buried: lifeEvent.optional(),
        occupation: z.array(z.string()).optional(),
        residence: z.array(residence).optional(),
        sources: z.array(z.string()).optional(),
        external: z.record(z.string(), z.unknown()).optional(),

        // Transitional compatibility with the first imported snapshot.
        id: z.string().optional(),
        displayName: z.string().optional(),
        birthSurname: z.string().optional(),
        marriedSurname: z.string().optional(),
        deceased: z.boolean().optional(),
        birth: looseDate.optional(),
        death: looseDate.optional(),

        // Other entity fields.
        date: looseDate.optional(),
        participants: z.array(z.string()).optional(),
        places: z.array(z.string()).optional(),
      }),
    }),
  }),
};
