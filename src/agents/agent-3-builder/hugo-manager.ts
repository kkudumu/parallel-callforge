import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HugoManager {
  ensureProject(): void;
  writeContentFile(filePath: string, frontmatter: Record<string, unknown>, content: string): void;
  writeTemplate(filePath: string, html: string): void;
  buildSite(): Promise<{ success: boolean; output: string }>;
}

export function createHugoManager(hugoSitePath: string): HugoManager {
  return {
    ensureProject() {
      const dirs = [
        "content",
        "layouts/_default",
        "layouts/partials",
        "static/css",
        "data",
      ];
      for (const dir of dirs) {
        fs.mkdirSync(path.join(hugoSitePath, dir), { recursive: true });
      }

      // Create config if it doesn't exist
      const configPath = path.join(hugoSitePath, "config.toml");
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `baseURL = "https://extermanation.com/"
languageCode = "en-us"
title = "Extermanation - Professional Pest Control"
theme = ""

[params]
  phone = "(555) 123-4567"
  business_name = "Extermanation"
`);
      }
    },

    writeContentFile(filePath, frontmatter, content) {
      const fullPath = path.join(hugoSitePath, "content", filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });

      const yamlLines = Object.entries(frontmatter)
        .map(([key, value]) => {
          if (typeof value === "string") return `${key}: "${value}"`;
          if (Array.isArray(value)) return `${key}:\n${value.map((v) => `  - "${v}"`).join("\n")}`;
          return `${key}: ${value}`;
        })
        .join("\n");

      const fileContent = `---\n${yamlLines}\n---\n\n${content}\n`;
      fs.writeFileSync(fullPath, fileContent, "utf-8");
    },

    writeTemplate(filePath, html) {
      const fullPath = path.join(hugoSitePath, "layouts", filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, html, "utf-8");
    },

    async buildSite() {
      try {
        const { stdout, stderr } = await execFileAsync("hugo", ["--minify"], {
          cwd: hugoSitePath,
          timeout: 30_000,
        });
        return { success: true, output: stdout + stderr };
      } catch (err: any) {
        return { success: false, output: err.stderr ?? err.message };
      }
    },
  };
}
