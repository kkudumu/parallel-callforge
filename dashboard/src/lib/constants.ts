import type { AgentName } from "./types";

export interface AgentMeta {
  name: AgentName;
  label: string;
  role: string;
  accessory: string;
  steps: string[];
  color: string;
  colorLight: string;
  colorDark: string;
}

export const AGENTS: Record<AgentName, AgentMeta> = {
  "agent-0.5": {
    name: "agent-0.5",
    label: "Mochi",
    role: "Geo Scanner",
    accessory: "compass",
    steps: [
      "Normalizing ZIPs",
      "Mapping coverage",
      "Clustering cities",
      "Scoring shortlist",
      "Saving candidates",
    ],
    color: "#FFE6A8",
    colorLight: "#FFF1C9",
    colorDark: "#F5B942",
  },
  "agent-1": {
    name: "agent-1",
    label: "Scout",
    role: "Keyword Research",
    accessory: "magnifying-glass",
    steps: [
      "Generating templates",
      "Expanding keywords",
      "Scoring cities",
      "Clustering",
      "Saving results",
    ],
    color: "#FFB5C2",
    colorLight: "#FFD4DC",
    colorDark: "#FF8FA3",
  },
  "agent-2": {
    name: "agent-2",
    label: "Artist",
    role: "Design Research",
    accessory: "paintbrush",
    steps: [
      "Competitor analysis",
      "Design spec",
      "Copy framework",
      "Schema templates",
      "Seasonal calendar",
    ],
    color: "#B5D8FF",
    colorLight: "#D4E8FF",
    colorDark: "#8FC4FF",
  },
  "agent-3": {
    name: "agent-3",
    label: "Builder",
    role: "Site Builder",
    accessory: "hard-hat",
    steps: [
      "Loading cities",
      "Hub page",
      "Subpages",
      "Quality check",
      "Hugo build",
    ],
    color: "#B5FFCF",
    colorLight: "#D4FFE2",
    colorDark: "#8FFFB5",
  },
  "agent-7": {
    name: "agent-7",
    label: "Doctor",
    role: "Performance Monitor",
    accessory: "stethoscope",
    steps: [
      "Loading pages",
      "Collecting metrics",
      "Evaluating thresholds",
      "Generating alerts",
      "Health score",
    ],
    color: "#FFD4B5",
    colorLight: "#FFE4D4",
    colorDark: "#FFC08F",
  },
};

export const AGENT_ORDER: AgentName[] = ["agent-0.5", "agent-1", "agent-2", "agent-3", "agent-7"];

export const MAX_FEED_ENTRIES = 100;

// WS connects to same host/port as the page (works through tunnels)
const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
export const WS_URL = `${wsProto}//${window.location.host}/ws`;
