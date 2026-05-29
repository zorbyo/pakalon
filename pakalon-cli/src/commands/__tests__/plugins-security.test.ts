import { describe, expect, it } from "vitest";
import {
  formatPackageVersionSpecifier,
  isValidNpmPackageName,
} from "../plugins.js";

describe("plugin package validation", () => {
  it("accepts npm package names used for plugin installs", () => {
    expect(isValidNpmPackageName("@pakalon/plugin-eslint")).toBe(true);
    expect(isValidNpmPackageName("pakalon-plugin-example")).toBe(true);
    expect(formatPackageVersionSpecifier("@pakalon/plugin-eslint", "1.2.3")).toBe("@pakalon/plugin-eslint@1.2.3");
  });

  it("rejects shell metacharacters before invoking npm", () => {
    expect(isValidNpmPackageName("eslint;rm -rf .")).toBe(false);
    expect(() => formatPackageVersionSpecifier("eslint", "1.0.0;whoami")).toThrow("Invalid npm package version");
  });
});
