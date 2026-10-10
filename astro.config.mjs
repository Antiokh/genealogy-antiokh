import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Семейная энциклопедия',
      description: 'Люди, события, места и источники семейной истории',
      locales: {
        root: {
          label: 'Русский',
          lang: 'ru',
        },
      },
      social: {
        github: 'https://github.com/Antiokh/genealogy-library',
      },
      sidebar: [
        { slug: 'index' },
        {
          label: 'Люди',
          autogenerate: { directory: 'people', collapsed: false },
        },
        {
          label: 'События',
          autogenerate: { directory: 'events', collapsed: false },
        },
        {
          label: 'Места',
          autogenerate: { directory: 'places', collapsed: true },
        },
        {
          label: 'Источники',
          autogenerate: { directory: 'sources', collapsed: true },
        },
      ],
    }),
  ],
});
