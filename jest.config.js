module.exports = {
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.pegjs?$': 'pegjs-jest',
  },
  globals: {
    DVT_AGGREGATION_VERSION: 'test',
  },
  testPathIgnorePatterns: ['/dist/', '/node_modules/'],
  coveragePathIgnorePatterns: ['/dist/', '/node_modules/', '/JetBrains/'],
}
