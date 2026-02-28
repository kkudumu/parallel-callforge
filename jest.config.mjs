/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      useESM: false,
      tsconfig: {
        module: "CommonJS",
        moduleResolution: "Node",
        verbatimModuleSyntax: false,
      },
    }],
  },
};

export default config;
