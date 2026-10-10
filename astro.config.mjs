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
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Antiokh/genealogy-library',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/Antiokh/genealogy-library/edit/main/src/content/docs/',
      },
      sidebar: [
        { label: 'Главная', link: '/' },
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
