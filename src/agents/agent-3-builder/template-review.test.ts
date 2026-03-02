import { describe, expect, it } from "@jest/globals";
import { reviewGeneratedHugoTemplates } from "./template-review.js";

describe("Template Review", () => {
  it("hoists nested define blocks out of generated child templates", () => {
    const result = reviewGeneratedHugoTemplates({
      baseof: "<html><body>{{ block \"main\" . }}{{ end }}</body></html>",
      city_hub: `{{ define "main" }}
<div>Hub content</div>
{{ define "schema" }}
<script>hub schema</script>
{{ end }}
{{ end }}`,
      service_subpage: `{{ define "main" }}
<div>Subpage content</div>
{{ define "sticky-call-bar" }}
<div>sticky</div>
{{ end }}
{{ define "schema" }}
<script>sub schema</script>
{{ end }}
{{ end }}`,
    });

    expect(result.repairsApplied).toEqual(
      expect.arrayContaining([
        "city_hub_nested_defines_hoisted",
        "service_subpage_nested_defines_hoisted",
      ])
    );
    expect(result.templates.city_hub).toContain(`{{ define "main" }}`);
    expect(result.templates.city_hub).toContain(`{{ define "schema" }}`);
    expect(result.templates.city_hub).not.toMatch(
      /{{ define "main" }}[\s\S]*{{ define "schema" }}[\s\S]*{{ end }}[\s\S]*{{ end }}$/
    );
    expect(result.templates.service_subpage).toContain(`{{ define "sticky-call-bar" }}`);
    expect(result.templates.service_subpage).toContain(`{{ define "schema" }}`);
  });

  it("strips an unnecessary baseof wrapper define", () => {
    const result = reviewGeneratedHugoTemplates({
      baseof: `{{ define "baseof" }}
<!DOCTYPE html>
<html><body>{{ block "main" . }}{{ end }}</body></html>
{{ end }}`,
      city_hub: `{{ define "main" }}<div>Hub</div>{{ end }}`,
      service_subpage: `{{ define "main" }}<div>Sub</div>{{ end }}`,
    });

    expect(result.repairsApplied).toContain("baseof_wrapper_normalized");
    expect(result.templates.baseof).toContain("<!DOCTYPE html>");
    expect(result.templates.baseof).not.toContain(`{{ define "baseof" }}`);
  });
});
