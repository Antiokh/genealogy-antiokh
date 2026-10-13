import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { buildPeopleSidebar } from './scripts/starlight-people-sidebar.mjs';

const peopleSidebar = buildPeopleSidebar();

export default defineConfig({
  site: 'https://genealogy-antiokh.pages.dev',
  integrations: [
    starlight({
      title: 'Семейная энциклопедия',
      description: 'Люди, события, места и источники семейной истории',
      routeMiddleware: './src/routeData.ts',
      customCss: [
        './src/styles/genealogy.css',
        './src/styles/photo-album.css',
        './src/styles/panel-motion.css',
        './src/styles/portrait-mourning.css',
        './src/styles/mobile-polish.css',
      ],
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
        baseUrl: 'https://github.com/Antiokh/genealogy-library/edit/main/',
      },
      components: {
        Head: './src/components/GenealogyHead.astro',
        Header: './src/components/GenealogyHeader.astro',
        PageTitle: './src/components/GenealogyPageTitle.astro',
        Footer: './src/components/GenealogyFooter.astro',
      },
      sidebar: [
        { label: 'Главная', link: '/' },
        {
          label: 'Люди',
          items: [
            { label: 'Все люди', link: '/people/' },
            ...peopleSidebar,
          ],
        },
        {
          label: 'События',
          items: [
            { autogenerate: { directory: 'events', collapsed: false } },
          ],
        },
        {
          label: 'Места',
          items: [
            { autogenerate: { directory: 'places', collapsed: true } },
          ],
        },
        {
          label: 'Источники',
          items: [
            { autogenerate: { directory: 'sources', collapsed: true } },
          ],
        },
      ],
    }),
  ],
});
