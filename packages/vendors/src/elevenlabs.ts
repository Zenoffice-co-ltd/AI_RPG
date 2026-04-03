import { z } from "zod";
import { requestJson } from "./http";

const kbDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const createAgentResponseSchema = z.object({
  agent_id: z.string().min(1),
});

const agentResponseSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1).optional(),
  version_id: z.string().nullable().optional(),
  branch_id: z.string().nullable().optional(),
  conversation_config: z.record(z.string(), z.unknown()).optional(),
});

const branchesResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      current_live_percentage: z.number().optional(),
      is_archived: z.boolean().optional(),
    })
  ),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
  }),
});

const createBranchResponseSchema = z.object({
  created_branch_id: z.string().min(1),
  created_version_id: z.string().min(1),
});

const testsListSchema = z.object({
  tests: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
  ),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

const createTestResponseSchema = z.object({
  id: z.string().min(1),
});

const runTestsResponseSchema = z.object({
  id: z.string().min(1),
  test_runs: z.array(
    z.object({
      test_run_id: z.string().min(1),
      test_id: z.string().min(1),
      status: z.string().min(1),
      test_name: z.string().min(1).optional(),
      condition_result: z
        .object({
          result: z.string().min(1),
        })
        .optional(),
    })
  ),
  agent_id: z.string().nullable().optional(),
  branch_id: z.string().nullable().optional(),
});

const knowledgeBaseListSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
  ),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

type AgentConfigPayload = {
  name: string;
  prompt: string;
  firstMessage: string;
  knowledgeBase: Array<{ id: string; name: string; type: "text" }>;
  model: string;
  voiceId: string;
  language: string;
};

type ApiKeyProvider = string | (() => Promise<string>);

function buildConversationConfig(payload: AgentConfigPayload) {
  return {
    agent: {
      first_message: payload.firstMessage,
      language: payload.language,
      prompt: {
        prompt: payload.prompt,
        knowledge_base: payload.knowledgeBase,
      },
    },
    conversation: {
      text_only: false,
    },
    llm: {
      model: payload.model,
      temperature: 0.2,
      reasoning: {
        effort: "none",
      },
    },
    tts: {
      voice_id: payload.voiceId,
      agent_output_audio_format: "pcm_24000",
    },
  };
}

export class ElevenLabsClient {
  constructor(
    private readonly apiKey: ApiKeyProvider,
    private readonly baseUrl = "https://api.elevenlabs.io"
  ) {}

  private async resolveApiKey() {
    return typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
  }

  async assertConnectivity() {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listKnowledgeBase",
      url: `${this.baseUrl}/v1/convai/knowledge-base?page_size=1`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: knowledgeBaseListSchema,
      timeoutMs: 20_000,
    });

    return response.documents;
  }

  async listKnowledgeBaseDocuments(search?: string) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({ page_size: "100" });
    if (search) {
      query.set("search", search);
    }

    const response = await requestJson({
      scope: "elevenlabs.listKnowledgeBaseDocuments",
      url: `${this.baseUrl}/v1/convai/knowledge-base?${query.toString()}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: knowledgeBaseListSchema,
      timeoutMs: 20_000,
    });

    return response.documents;
  }

  async createKnowledgeBaseDocumentFromText(name: string, text: string) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createKnowledgeBaseDocumentFromText",
      url: `${this.baseUrl}/v1/convai/knowledge-base/text`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        text,
      }),
      schema: kbDocumentSchema,
      timeoutMs: 30_000,
    });

    return response;
  }

  async createAgent(input: AgentConfigPayload) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createAgent",
      url: `${this.baseUrl}/v1/convai/agents/create?enable_versioning=true`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        conversation_config: buildConversationConfig(input),
        platform_settings: {
          widget: null,
          testing: {
            tests: [],
          },
        },
      }),
      schema: createAgentResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });

    return response;
  }

  async getAgent(agentId: string, branchId?: string) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams();
    if (branchId) {
      query.set("branch_id", branchId);
    }

    const response = await requestJson({
      scope: "elevenlabs.getAgent",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: agentResponseSchema,
      timeoutMs: 20_000,
    });

    return response;
  }

  async updateAgent(
    agentId: string,
    input: AgentConfigPayload,
    options?: { branchId?: string }
  ) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({
      enable_versioning_if_not_enabled: "true",
    });
    if (options?.branchId) {
      query.set("branch_id", options.branchId);
    }

    return requestJson({
      scope: "elevenlabs.updateAgent",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}?${query.toString()}`,
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        conversation_config: buildConversationConfig(input),
        version_description: "Published from Top Performer Roleplay MVP",
      }),
      schema: agentResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });
  }

  async listBranches(agentId: string) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listBranches",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches?include_archived=false&limit=100`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: branchesResponseSchema,
      timeoutMs: 20_000,
    });

    return response.results;
  }

  async createBranch(
    agentId: string,
    parentVersionId: string,
    name: string,
    description: string
  ) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.createBranch",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parent_version_id: parentVersionId,
        name,
        description,
      }),
      schema: createBranchResponseSchema,
      timeoutMs: 20_000,
    });
  }

  async mergeBranch(agentId: string, sourceBranchId: string, targetBranchId: string) {
    const apiKey = await this.resolveApiKey();
    await requestJson({
      scope: "elevenlabs.mergeBranch",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches/${sourceBranchId}/merge?target_branch_id=${targetBranchId}`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        archive_source_branch: false,
      }),
      schema: z.record(z.string(), z.unknown()),
      timeoutMs: 20_000,
    });
  }

  async listTests() {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listTests",
      url: `${this.baseUrl}/v1/convai/agent-testing?page_size=100`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: testsListSchema,
      timeoutMs: 20_000,
    });

    return response.tests;
  }

  async createTest(body: Record<string, unknown>) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createTest",
      url: `${this.baseUrl}/v1/convai/agent-testing/create`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      schema: createTestResponseSchema,
      timeoutMs: 20_000,
    });

    return response.id;
  }

  async updateTest(testId: string, body: Record<string, unknown>) {
    const apiKey = await this.resolveApiKey();
    await requestJson({
      scope: "elevenlabs.updateTest",
      url: `${this.baseUrl}/v1/convai/agent-testing/${testId}`,
      method: "PUT",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      schema: z.record(z.string(), z.unknown()),
      timeoutMs: 20_000,
    });
  }

  async runTests(agentId: string, testIds: string[], branchId?: string) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.runTests",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/run-tests`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tests: testIds.map((testId) => ({ test_id: testId })),
        ...(branchId ? { branch_id: branchId } : {}),
      }),
      schema: runTestsResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });
  }
}
