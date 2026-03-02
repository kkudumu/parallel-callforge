import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DeployResult {
  success: boolean;
  url: string;
  output: string;
}

export interface HugoManager {
  ensureProject(): void;
  writeContentFile(filePath: string, frontmatter: Record<string, unknown>, content: string): void;
  writeTemplate(filePath: string, html: string): void;
  writeStaticFile(filePath: string, content: string | Buffer): void;
  buildSite(): Promise<{ success: boolean; output: string }>;
  deployDraftSite(siteId: string): Promise<DeployResult>;
  publishSite(siteId: string): Promise<DeployResult>;
}

export function createHugoManager(hugoSitePath: string): HugoManager {
  function formatExecFailure(err: any): string {
    const stdout = typeof err?.stdout === "string" ? err.stdout.trim() : "";
    const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
    const message = typeof err?.message === "string" ? err.message.trim() : "Unknown command failure";
    return [stdout, stderr, message].filter(Boolean).join("\n");
  }

  function toYamlKey(key: string): string {
    return `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function writeIfMissing(targetPath: string, content: string): void {
    if (fs.existsSync(targetPath)) {
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf-8");
  }

  function toYamlValue(value: unknown, indent = 0): string {
    const pad = " ".repeat(indent);

    if (value === null || value === undefined) {
      return "null";
    }

    if (typeof value === "string") {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }

      return value
        .map((item) => {
          if (
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item)
          ) {
            const nested = toYamlValue(item, indent + 2);
            return `${pad}-\n${nested}`;
          }

          if (Array.isArray(item)) {
            const nested = toYamlValue(item, indent + 2);
            return `${pad}-\n${nested}`;
          }

          return `${pad}- ${toYamlValue(item, 0)}`;
        })
        .join("\n");
    }

    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        return "{}";
      }

      return entries
        .map(([key, nestedValue]) => {
          if (
            nestedValue !== null &&
            typeof nestedValue === "object"
          ) {
            return `${pad}${toYamlKey(key)}:\n${toYamlValue(nestedValue, indent + 2)}`;
          }

          return `${pad}${toYamlKey(key)}: ${toYamlValue(nestedValue, 0)}`;
        })
        .join("\n");
    }

    return `"${String(value)}"`;
  }

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

[params]
  phone = "(555) 123-4567"
  phone_raw = "5551234567"
  business_name = "Extermanation"
  tagline = "Local pest control service built for fast inspections and same-day scheduling."
`);
      } else {
        let configContent = fs.readFileSync(configPath, "utf-8");
        let updated = false;

        if (configContent.includes('theme = ""')) {
          configContent = configContent.replace(/\ntheme\s*=\s*""\s*\n/g, "\n");
          updated = true;
        }

        if (configContent.includes("[params]")) {
          if (!configContent.includes("phone_raw")) {
            configContent = configContent.replace("[params]\n", "[params]\n  phone_raw = \"5551234567\"\n");
            updated = true;
          }

          if (!configContent.includes("tagline")) {
            configContent = configContent.replace("[params]\n", "[params]\n  tagline = \"Local pest control service built for fast inspections and same-day scheduling.\"\n");
            updated = true;
          }
        }

        if (updated) {
          fs.writeFileSync(configPath, configContent, "utf-8");
        }
      }

      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/header.html"),
        `<header class="site-header">
  <div class="container header-inner">
    <a href="/" class="site-logo">{{ .Site.Title }}</a>
    <div class="header-cta">
      <a href="tel:{{ .Site.Params.phone_raw }}" class="header-phone">Call {{ .Site.Params.phone }}</a>
      <p class="call-recording-note">Calls may be recorded for quality assurance.</p>
    </div>
  </div>
</header>
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/footer.html"),
        `<footer class="site-footer">
  <div class="container">
    <p><strong>{{ .Site.Params.business_name }}</strong> connects consumers with local pest control professionals.</p>
    <p>DISCLAIMER: {{ .Site.Params.business_name }} is a free referral service connecting consumers with pest control professionals. We are not a pest control company. Calls may be recorded for quality assurance. By calling the number on this page, you consent to potential call recording and acknowledge your call may be directed to a third-party service provider.</p>
    <p><a href="/privacy-policy/">Privacy Policy</a> | <a href="/terms-of-service/">Terms of Service</a> | <a href="/do-not-sell/">Do Not Sell My Personal Information</a></p>
  </div>
</footer>
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/cta-badge.html"),
        `<div class="cta-badge">Local team. Fast scheduling. Clear next steps.</div>
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/cta-sticky.html"),
        `<div class="cta-sticky">
  <a href="tel:{{ .Site.Params.phone_raw }}">Call {{ .Site.Params.phone }}</a>
  <p class="call-recording-note">Calls may be recorded for quality assurance.</p>
</div>
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/faq.html"),
        `{{ range .Params.faq }}
<details class="faq-item">
  <summary>{{ .question }}</summary>
  <p>{{ .answer }}</p>
</details>
{{ end }}
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "layouts/partials/schema-jsonld.html"),
        `<script type="application/ld+json">
{{ if .Params.schema_template }}
{{ .Params.schema_template | jsonify | safeJS }}
{{ else }}
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "{{ .Site.Params.business_name }}",
  "url": "{{ .Permalink }}",
  "telephone": "{{ .Site.Params.phone }}"
}
{{ end }}
</script>
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "content/privacy-policy.md"),
        `---
title: "Privacy Policy"
draft: false
---

This site uses call tracking and referral routing to connect consumers with independent service providers. We may collect phone numbers, call duration, IP address, browsing data, and attribution parameters needed for routing, analytics, compliance, and quality assurance.

Calls placed through this site may be shared with referral partners, call tracking vendors, analytics tools, and independent service providers participating in our network.

If you need to request deletion, correction, or additional disclosure regarding personal data handling, contact the number listed on this site.
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "content/terms-of-service.md"),
        `---
title: "Terms of Service"
draft: false
---

This website is a referral and lead generation service. We are not the direct service provider. Calls may be routed to independent third-party businesses. We do not guarantee service quality, pricing, scheduling, or availability from any provider reached through this site.

By using this site or calling the phone numbers shown here, you agree that calls may be recorded or monitored for quality assurance and routing purposes.
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "content/do-not-sell.md"),
        `---
title: "Do Not Sell My Personal Information"
draft: false
---

If you are requesting that your personal information not be sold or shared beyond what is necessary for compliance and call routing, contact the phone number listed on this site and request a privacy review.
`
      );
      writeIfMissing(
        path.join(hugoSitePath, "static/css/main.css"),
        `body {
  margin: 0;
  font-family: var(--font-body, "Segoe UI", sans-serif);
  color: #14213d;
}

.container {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
}

.site-header,
.site-footer,
.cta-sticky {
  padding: 16px 0;
}

.header-inner,
.site-footer {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.cta-button,
.header-phone,
.cta-sticky a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  padding: 0 20px;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 700;
}

.cta-button,
.header-phone,
.cta-sticky a,
.site-logo {
  color: inherit;
}

.cta-primary,
.header-phone,
.cta-sticky a {
  background: var(--color-primary, #ff6b00);
  color: #fff;
}

.service-card,
.premium-card {
  display: block;
  padding: 24px;
  background: #fff;
  text-decoration: none;
  color: inherit;
}

.grid {
  display: grid;
  gap: 20px;
}

.cta-sticky {
  position: sticky;
  bottom: 0;
  background: rgba(255,255,255,0.96);
  border-top: 1px solid rgba(0,0,0,0.08);
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`
      );
    },

    writeContentFile(filePath, frontmatter, content) {
      const fullPath = path.join(hugoSitePath, "content", filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });

      const yamlLines = Object.entries(frontmatter)
        .map(([key, value]) => `${toYamlKey(key)}: ${typeof value === "object" && value !== null ? "\n" + toYamlValue(value, 2) : toYamlValue(value, 0)}`)
        .join("\n");

      const fileContent = `---\n${yamlLines}\n---\n\n${content}\n`;
      fs.writeFileSync(fullPath, fileContent, "utf-8");
    },

    writeTemplate(filePath, html) {
      const fullPath = path.join(hugoSitePath, "layouts", filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, html, "utf-8");
    },

    writeStaticFile(filePath, content) {
      const fullPath = path.join(hugoSitePath, "static", filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (typeof content === "string") {
        fs.writeFileSync(fullPath, content, "utf-8");
        return;
      }
      fs.writeFileSync(fullPath, content);
    },

    async buildSite() {
      try {
        const { stdout, stderr } = await execFileAsync("hugo", ["--minify"], {
          cwd: hugoSitePath,
          timeout: 30_000,
        });
        return { success: true, output: stdout + stderr };
      } catch (err: any) {
        return { success: false, output: formatExecFailure(err) };
      }
    },

    async deployDraftSite(siteId: string): Promise<DeployResult> {
      const publicDir = path.join(hugoSitePath, "public");
      try {
        const { stdout, stderr } = await execFileAsync(
          "netlify",
          ["deploy", "--dir", publicDir, "--site", siteId, "--json"],
          { cwd: hugoSitePath, timeout: 120_000 }
        );

        // --json flag outputs JSON with deploy_url and url fields
        try {
          const result = JSON.parse(stdout);
          const url = result.url || result.deploy_url || "";
          return { success: true, url, output: stdout + stderr };
        } catch {
          // Fallback: parse URL from text output
          const urlMatch = stdout.match(/Website URL:\s+(https?:\/\/\S+)/i)
            || stdout.match(/(https:\/\/[^\s]+\.netlify\.app\S*)/);
          const url = urlMatch?.[1] || "";
          return { success: true, url, output: stdout + stderr };
        }
      } catch (err: any) {
        return { success: false, url: "", output: formatExecFailure(err) };
      }
    },

    async publishSite(siteId: string): Promise<DeployResult> {
      const publicDir = path.join(hugoSitePath, "public");
      try {
        const { stdout, stderr } = await execFileAsync(
          "netlify",
          ["deploy", "--prod", "--dir", publicDir, "--site", siteId, "--json"],
          { cwd: hugoSitePath, timeout: 120_000 }
        );

        try {
          const result = JSON.parse(stdout);
          const url = result.url || result.deploy_url || "";
          return { success: true, url, output: stdout + stderr };
        } catch {
          const urlMatch = stdout.match(/Website URL:\s+(https?:\/\/\S+)/i)
            || stdout.match(/(https:\/\/[^\s]+\.netlify\.app\S*)/);
          const url = urlMatch?.[1] || "";
          return { success: true, url, output: stdout + stderr };
        }
      } catch (err: any) {
        return { success: false, url: "", output: formatExecFailure(err) };
      }
    },
  };
}
