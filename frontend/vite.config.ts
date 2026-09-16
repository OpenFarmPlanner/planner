import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import { seoPlugin } from './build/seoPlugin.ts'
import { BRAND_PRIMARY_MAIN, BRAND_ROOT_BACKGROUND } from './src/brandColors.ts'

function normalizeBasePath(input?: string): string {
  const value = input && input.trim().length > 0 ? input.trim() : '/'
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`

  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const basePath = normalizeBasePath(process.env.VITE_BASE_PATH)
const backendDevOrigin = process.env.DEV_BACKEND_ORIGIN || 'http://127.0.0.1:8000'
const websocketProxyPath = basePath === '/' ? '/ws' : `${basePath.slice(0, -1)}/ws`

// Shared by the dev server and `vite preview` (used for production-build E2E runs), so
// requests to the Django backend work the same way regardless of which one serves the SPA.
const backendProxy = {
  '/admin': { target: backendDevOrigin, changeOrigin: true },
  '/api': { target: backendDevOrigin, changeOrigin: true },
  '/static': { target: backendDevOrigin, changeOrigin: true },
  '/media': { target: backendDevOrigin, changeOrigin: true },
  [websocketProxyPath]: { target: backendDevOrigin, ws: true, changeOrigin: true },
}

// Minimal PWA support: installability plus a faster start from cached build
// assets. Deliberately *not* an offline mode — see docs/pwa.md.
//
// Precaching covers the fingerprinted build output only (JS chunks, CSS,
// fonts) plus the app icons. Two things are excluded on purpose:
//
//   * HTML documents. `postbuild` rewrites dist/index.html (and the
//     prerendered public routes) after Vite has emitted them, and the
//     authenticated shell is served through SPA-fallback rewriting, so a
//     precached document would go stale the moment either changes. Without a
//     cached document there is also no `navigateFallback`, which keeps every
//     navigation on the network.
//   * The landing page's hero and screenshot images. They are marketing
//     assets for a page an installed app never starts on, and precaching
//     several megabytes of WebP for them would cost exactly the startup time
//     this is meant to save.
//
// Every request under the API prefix is pinned to NetworkOnly. That is
// belt-and-braces — nothing routes API traffic into a cache today — but it is
// the rule a future change would otherwise have to rediscover:
//
//   API requests carry the multi-tenancy headers X-Project-Id and
//   X-Season-Id (src/api/httpClient.ts). The URL alone does not identify a
//   response, so any future API caching MUST fold those headers into the
//   cache key. Caching on the URL would serve one project's or season's data
//   to another, and would hand users stale planning data with no way to tell.
function pwaPlugin() {
  const apiPathPrefix = basePath === '/' ? '/api/' : `${basePath}api/`

  return VitePWA({
    registerType: 'autoUpdate',
    // Registration lives in src/pwa/registerServiceWorker.ts so it is
    // explicit in the entry point rather than injected into index.html.
    injectRegister: null,
    manifestFilename: 'manifest.json',
    manifest: {
      name: 'OpenFarmPlanner',
      short_name: 'OFP',
      description: 'Anbauplanung für Gemüsebaubetriebe',
      lang: 'de',
      display: 'standalone',
      // The installed app is the authenticated planner, not the public
      // landing page; `/app` itself only redirects here.
      start_url: `${basePath}app/dashboard`,
      scope: basePath,
      // Mirrors palette.primary.main and palette.surface.rootBackground.
      theme_color: BRAND_PRIMARY_MAIN,
      background_color: BRAND_ROOT_BACKGROUND,
      icons: [
        { src: `${basePath}icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${basePath}icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
        {
          src: `${basePath}icons/pwa-maskable-512x512.png`,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      // The manifest icons are added by the plugin itself
      // (`includeManifestIcons`), so this only has to name the build output
      // and the favicon.
      globPatterns: ['assets/**/*.{js,css,woff,woff2}', 'favicon.png'],
      // Overrides the plugin's 'index.html' default: no HTML is precached, so
      // there is nothing to fall back to and navigations stay on the network.
      navigateFallback: undefined,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          // workbox-build serializes this matcher into sw.js by calling
          // Function.prototype.toString() on it (see workbox-build's
          // runtime-caching-converter.js) and re-evaluating that source in
          // the worker — which has no access to this module's scope. A
          // closure over `apiPathPrefix` compiles here but throws
          // "apiPathPrefix is not defined" once the worker runs it. Build
          // the function so its source has the value baked in as a literal
          // instead of a free variable: `Function`'s own toString() output
          // is exactly its parameter list and body, nothing else.
          urlPattern: new Function(
            '{ url, sameOrigin }',
            `return sameOrigin && url.pathname.startsWith(${JSON.stringify(apiPathPrefix)});`,
          ) as (options: { url: URL; sameOrigin: boolean }) => boolean,
          handler: 'NetworkOnly',
        },
      ],
    },
  })
}

// The head tags the manifest cannot cover: iOS ignores the manifest's icons
// for "Add to Home Screen", and `theme-color` colours the browser chrome
// before the manifest is parsed. Both read the brand constants rather than
// repeating a literal colour or icon path.
function pwaHeadTagsPlugin(): Plugin {
  const tags = [
    `<meta name="theme-color" content="${BRAND_PRIMARY_MAIN}" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<link rel="apple-touch-icon" href="${basePath}icons/pwa-192x192.png" />`,
  ]

  return {
    name: 'openfarmplanner-pwa-head-tags',
    transformIndexHtml(html: string) {
      const injection = `${tags.map((tag) => `    ${tag}`).join('\n')}\n  </head>`
      return html.replace(/\s*<\/head>/, `\n${injection}`)
    },
  }
}

function manualChunks(id: string): string | undefined {
  if (!id.includes('/node_modules/')) {
    return undefined
  }

  if (
    id.includes('/node_modules/react/') ||
    id.includes('/node_modules/react-dom/') ||
    id.includes('/node_modules/react-router/')
  ) {
    return 'react'
  }

  if (id.includes('/node_modules/@mui/icons-material/')) {
    return 'muiIcons'
  }

  if (id.includes('/node_modules/@mui/material/')) {
    return 'mui'
  }

  if (
    id.includes('/node_modules/i18next/') ||
    id.includes('/node_modules/react-i18next/')
  ) {
    return 'i18n'
  }

  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [react(), seoPlugin(process.env), pwaPlugin(), pwaHeadTagsPlugin()],
  optimizeDeps: {
    include: ['tiptap-markdown'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    watch: {
      ignored: [
        '**/coverage/**',
        '**/dist/**',
        '**/.git/**',
        '**/node_modules/.cache/**',
      ],
    },
    proxy: backendProxy,
  },
  preview: {
    proxy: backendProxy,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 5000,
    pool: process.env.CI ? 'forks' : 'threads',
    // Run test files in parallel everywhere, CI included. This used to be
    // disabled under CI, which serialized all ~240 files onto one worker and
    // was the single biggest contributor to the job's runtime (392s -> 240s
    // locally on 4 cores when re-enabled, with an unchanged 2405-test result).
    // The pool size is left at Vitest's default, which already derives from the
    // machine's available parallelism; each fork carries a full jsdom + MUI
    // module graph, so raising it past that costs more in memory than it wins.
    fileParallelism: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'build/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: ['@mui/x-data-grid', '@mui/material'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'src/__tests__/**',
        'src/test-utils/**',
        'src/setupTests.ts',
        '**/*.test.{ts,tsx}',
        '**/*.config.{ts,js}',
        '**/types.ts',
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
