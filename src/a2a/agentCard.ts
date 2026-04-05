/**
 * A2A Agent Card — served at /.well-known/agent-card.json
 * Follows the A2A protocol spec for agent discovery.
 * https://a2a-protocol.org/latest/topics/agent-discovery/
 */

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  documentationURL?: string;
  provider: {
    organization: string;
    url: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  authentication: {
    required: boolean;
    schemes: Array<{ scheme: string; description?: string }>;
  };
  interactionModes: {
    defaultInputMimeType: string;
    defaultOutputMimeType: string;
  };
  skills: Array<{
    name: string;
    description: string;
    inputMode: {
      mimeType: string;
      schema?: Record<string, unknown>;
    };
    outputMode: {
      mimeType: string;
      schema?: Record<string, unknown>;
    };
  }>;
}

export function buildAgentCard(baseUrl: string): AgentCard {
  return {
    name: "Briefly",
    description:
      "AI-powered innovation intelligence agent. Acts as Innovation Director for creative agencies — synthesizes AI industry news, recommends tools for specific projects, and generates strategic briefs.",
    url: baseUrl,
    version: "1.0.0",
    documentationURL: `${baseUrl}/docs`,
    provider: {
      organization: "Briefly",
      url: baseUrl,
    },
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: false,
    },
    authentication: {
      required: false,
      schemes: [{ scheme: "none", description: "Publicly accessible — no authentication required" }],
    },
    interactionModes: {
      defaultInputMimeType: "application/json",
      defaultOutputMimeType: "application/json",
    },
    skills: [
      {
        name: "search_tools",
        description:
          "Find AI tools from Futurepedia and Product Hunt that match a project description",
        inputMode: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Project or use case description" },
              category: {
                type: "string",
                enum: ["tool", "news", "leaderboard", "any"],
                default: "tool",
              },
              limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
            },
            required: ["query"],
          },
        },
        outputMode: {
          mimeType: "application/json",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                source: { type: "string" },
                url: { type: "string" },
                summary: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      {
        name: "industry_summary",
        description:
          "Get a synthesized summary of the latest AI industry news from The Rundown AI and The Neuron Daily",
        inputMode: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              source: {
                type: "string",
                enum: ["therundown", "theneuron", "all"],
                default: "all",
              },
              limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
            },
          },
        },
        outputMode: {
          mimeType: "application/json",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                source: { type: "string" },
                url: { type: "string" },
                summary: { type: "string" },
                publishedAt: { type: "string" },
              },
            },
          },
        },
      },
      {
        name: "generate_brief",
        description:
          "Generate a structured innovation brief for a topic or project using Gemma 4 AI",
        inputMode: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "Project or topic to generate a brief for",
                maxLength: 500,
              },
            },
            required: ["topic"],
          },
        },
        outputMode: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              topic: { type: "string" },
              generatedAt: { type: "string" },
              summary: { type: "string" },
              recommendedTools: { type: "array" },
              keyNews: { type: "array" },
              leaderboardSnapshot: { type: "array" },
            },
          },
        },
      },
      {
        name: "model_leaderboard",
        description: "Retrieve current AI model rankings from Arena.ai leaderboard",
        inputMode: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
            },
          },
        },
        outputMode: {
          mimeType: "application/json",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rank: { type: "number" },
                model: { type: "string" },
                provider: { type: "string" },
                score: { type: "string" },
              },
            },
          },
        },
      },
    ],
  };
}
