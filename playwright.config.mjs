const config = {
  testDir: './e2e',
  timeout: 240000,
  expect: {
    timeout: 30000,
  },
  outputDir: './playwright-artifacts/test-results',
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:4000',
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1920, height: 1080 },
  },
};

export default config;
