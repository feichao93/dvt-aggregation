module.exports = {
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.pegjs?$': 'pegjs-jest',
  },
  testPathIgnorePatterns: ['/dist/', '/node_modules/'],
  coveragePathIgnorePatterns: ['/dist/', '/node_modules/', '/JetBrains/'],
}
