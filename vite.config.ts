import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import path from 'path';

export default defineConfig({
    plugins: [
        dts({
            outDir: 'dist',
            insertTypesEntry: true,
        }),
    ],
    build: {
        target: 'esnext',
        outDir: 'dist',
        lib: {
            entry: './src/index.ts',
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            external: [
                // External packages
                '@redaksjon/context',
                '@redaksjon/protokoll-format',
                '@anthropic-ai/sdk',
                '@google/generative-ai',
                '@kjerneverk/riotprompt',
                '@utilarium/dreadcabinet',
                'openai',
                'winston',
                'zod',
                'dayjs',
                'luxon',
                'moment-timezone',
                'gray-matter',
                'js-yaml',
                'fluent-ffmpeg',
                'glob',
                // Node.js built-ins
                'node:fs',
                'node:fs/promises',
                'node:path',
                'node:os',
                'node:url',
                'node:child_process',
                'node:stream',
                'node:util',
                'node:readline',
                'node:crypto',
                'fs',
                'readline',
                'fs/promises',
                'path',
                'os',
                'url',
                'child_process',
                'stream',
                'util',
                'crypto',
            ],
            output: {
                preserveModules: true,
                preserveModulesRoot: 'src',
                exports: 'named',
            },
        },
        modulePreload: false,
        minify: false,
        sourcemap: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
});
