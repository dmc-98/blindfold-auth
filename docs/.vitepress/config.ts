import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Blindfold Auth',
  description: 'Local-first authentication and authorization for Node.js — no hosted control plane, no paywalled features.',
  lang: 'en-US',
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#1a1a2e' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Blindfold Auth' }],
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  ],

  themeConfig: {
    logo: { src: '/favicon.svg', alt: 'Blindfold Auth' },

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Authorization', link: '/authz/overview', activeMatch: '/authz/' },
      { text: 'CLI', link: '/cli/doctor', activeMatch: '/cli/' },
      { text: 'SSO', link: '/sso/', activeMatch: '/sso/' },
      { text: 'API', link: '/api-reference' },
      {
        text: 'v0.1.x',
        items: [
          { text: 'Changelog', link: 'https://github.com/dmc-98/blindfold-auth/blob/main/CHANGELOG.md' },
          { text: 'Contributing', link: 'https://github.com/dmc-98/blindfold-auth/blob/main/CONTRIBUTING.md' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Blindfold Auth?', link: '/guide/what-is-blindfold' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/concepts' },
          ],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Configuration Reference', link: '/guide/configuration' },
            { text: 'Deployment', link: '/guide/deployment' },
          ],
        },
        {
          text: 'Authentication',
          items: [
            { text: 'Passwords', link: '/guide/passwords' },
            { text: 'Passkeys & MFA', link: '/guide/mfa' },
            { text: 'Sessions', link: '/guide/sessions' },
            { text: 'Security Defaults', link: '/guide/security' },
          ],
        },
      ],
      '/authz/': [
        {
          text: 'Authorization',
          items: [
            { text: 'Overview', link: '/authz/overview' },
            { text: 'Policies', link: '/authz/policies' },
            { text: 'Explain Decisions', link: '/authz/explain' },
            { text: 'Dry Run', link: '/authz/dry-run' },
            { text: 'Policy Testing', link: '/authz/testing' },
          ],
        },
        {
          text: 'Observability',
          items: [
            { text: 'Audit Log', link: '/audit' },
          ],
        },
      ],
      '/cli/': [
        {
          text: 'CLI',
          items: [
            { text: 'blindfold doctor', link: '/cli/doctor' },
            { text: 'blindfold sso doctor', link: '/cli/sso-doctor' },
            { text: 'Studio UI', link: '/cli/studio' },
          ],
        },
      ],
      '/sso/': [
        {
          text: 'SSO Recipes',
          items: [
            { text: 'Overview', link: '/sso/' },
            { text: 'Okta', link: '/sso/okta' },
            { text: 'Microsoft Entra ID', link: '/sso/entra' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dmc-98/blindfold-auth' },
    ],

    editLink: {
      pattern: 'https://github.com/dmc-98/blindfold-auth/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Apache 2.0 · MIT-licensed packages · No paywalled features.',
    },

    search: { provider: 'local' },
  },
})
