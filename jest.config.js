/* eslint-env node */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jest-environment-jsdom',
    cacheDirectory: '.jest-cache',
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
};
