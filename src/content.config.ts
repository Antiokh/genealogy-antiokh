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
  placeLabel: z.string().optional(),
}).passthrough();

const localizedName = z.object({
  first: z.string().optional(),
  middle: z.string().optional(),
  last: z.string().optional(),
  display: z.string().optional(),
}).passthrough();

const structuredName = z.object({
  full: z.string().optional(),
  display: z.string().optional(),
  locale: z.string().optional(),
  first: z.string().optional(),
  middle: z.string().optional(),
  patronymic: z.string().optional(),
  last: z.string().optional(),
  birth_last: z.string().optional(),
  married_last: z.string().optional(),
  localized: z.record(z.string(), localizedName).optional(),
  aliases: z.array(z.string()).optional(),
}).passthrough();

const familyGroup = z.union([
  z.string(),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    locale: z.string().optional(),
    localized: z.record(z.string(), z.string()).optional(),
    roles: z.array(z.string()).optional(),
    inferred: z.boolean().optional(),
  }).passthrough(),
]);

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
  label: z.string().optional(),
  from: dateValue.nullish(),
  to: dateValue.nullish(),
}).passthrough();

const geoPoint = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  precision: z.enum(['exact', 'building', 'city', 'region', 'representative']).optional(),
}).passthrough();

const historicalName = z.object({
  name: z.string(),
  from: dateValue.nullish(),
  to: dateValue.nullish(),
}).passthrough();

const provenance = z.object({
  source: z.string(),
  locator: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  note: z.string().optional(),
}).passthrough();

const work = z.object({
  title: z.string(),
  year: z.number().int().optional(),
  publication: z.string().optional(),
  imprint: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

const archiveHolding = z.object({
  repository: z.string(),
  fund: z.string().optional(),
  units: z.number().int().optional(),
  dates: z.string().optional(),
  url: z.string().optional(),
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
        families: z.array(familyGroup).optional(),
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
        researchInterests: z.array(z.string()).optional(),
        courses: z.array(z.string()).optional(),
        works: z.array(work).optional(),
        archives: z.array(archiveHolding).optional(),
        sources: z.array(z.string()).optional(),
        external: z.record(z.string(), z.unknown()).optional(),

        // Event fields. References are relative to their entity collection roots.
        kind: z.string().optional(),
        date: dateValue.optional(),
        endDate: dateValue.nullish(),
        timeline: z.boolean().optional(),
        importance: z.enum(['major', 'standard', 'minor']).optional(),
        summary: z.string().optional(),
        participants: z.array(z.string()).optional(),
        places: z.array(z.string()).optional(),
        provenance: z.array(provenance).optional(),

        // Place fields.
        label: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        historicalNames: z.array(historicalName).optional(),
        geo: geoPoint.nullish(),
        parent: z.string().nullish(),
        country: z.string().optional(),

        // Source fields.
        sourceType: z.string().optional(),
        url: z.string().optional(),
        author: z.string().optional(),
        year: z.number().int().optional(),
        publication: z.string().optional(),
        locator: z.string().optional(),

        // Transitional compatibility with earlier snapshots.
        family: familyGroup.optional(),
        id: z.string().optional(),
        displayName: z.string().optional(),
        birthSurname: z.string().optional(),
        marriedSurname: z.string().optional(),
        deceased: z.boolean().optional(),
        birth: looseDate.optional(),
        death: looseDate.optional(),
      }),
    }),
  }),
};
