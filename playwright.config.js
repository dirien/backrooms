import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 60000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:5173',
        viewport: { width: 800, height: 500 },
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] },
    },
    webServer: {
        command: 'npm run dev -- --host 0.0.0.0 --port 5173',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: true,
    },
});
