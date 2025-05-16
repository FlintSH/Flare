module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '@/(.*)': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
        isolatedModules: true,
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(nanoid)/)', // Allow transforming nanoid, which uses ESM
  ],
  testMatch: [
    '**/__tests__/**/*.test.(ts|tsx)',
    '**/__tests__/**/*.spec.(ts|tsx)',
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  collectCoverageFrom: [
    'app/api/**/*.ts',
    '!app/api/**/*.d.ts',
    '!**/__tests__/**',
    '!**/node_modules/**',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  modulePathIgnorePatterns: ['.next'],
  testTimeout: 15000,
  // Prevent TypeScript errors from route handlers in tests
  globals: {
    'ts-jest': {
      isolatedModules: true,
      diagnostics: {
        ignoreCodes: [
          'TS2339', // Property does not exist
          'TS2345', // Argument is not assignable
          'TS2451', // Cannot redeclare variable
          'TS2353', // Object literal may only specify known properties
          'TS2541', // Cannot assign to property because it is a method
        ],
      },
    },
  },
}
