import "dotenv/config";
import { createJsWithTsEsmPreset, type JestConfigWithTsJest } from 'ts-jest'

const esmPreset = createJsWithTsEsmPreset({
  diagnostics: true
})

const config: JestConfigWithTsJest = {
  ...esmPreset,
  verbose: true,
  resetModules: true,
  moduleNameMapper: {
    '^@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/(.*).js$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: ['node_modules'],
  testPathIgnorePatterns: [".scratch", "dist", "node_modules"],
};

console.log(JSON.stringify(config, null, 2));
export default config;
