import { ChatOpenAI } from "@langchain/openai";

export function createInvestigationModel(
  options: {
    model?: string;
    maxTokens?: number;
    maxRetries?: number;
  } = {},
) {
  const model = options.model ?? process.env.OPENAI_MODEL;
  if (!model)
    throw new Error("Set OPENAI_MODEL to an available tool-capable model");
  return new ChatOpenAI({
    model,
    useResponsesApi: true,
    reasoning: { effort: "low" },
    ...(options.maxTokens === undefined
      ? {}
      : { maxTokens: options.maxTokens }),
    ...(options.maxRetries === undefined
      ? {}
      : { maxRetries: options.maxRetries }),
  });
}
