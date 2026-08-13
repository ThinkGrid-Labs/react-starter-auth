/* eslint-env node */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jest-environment-jsdom',
    cacheDirectory: '.jest-cache',
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
    // e2e/ holds Playwright specs, which jest must not try to run.
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],

    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/__tests__/**',
        // Barrel files: pure re-exports with no logic to cover.
        '!src/index.tsx',
        '!src/core/index.ts',
        '!src/server/index.ts',
    ],

    // Set just under what the suite currently achieves, so a regression fails
    // the build but ordinary refactoring does not.
    coverageThreshold: {
        global: {
            statements: 93,
            branches: 84,
            functions: 95,
            lines: 96,
        },
    },
};
