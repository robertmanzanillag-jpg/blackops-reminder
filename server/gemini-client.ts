import { GoogleGenAI } from "@google/genai";
import { hasRealValue } from "./ceo-doctor-cli";

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!hasRealValue(apiKey)) {
    throw new Error("AI_INTEGRATIONS_GEMINI_API_KEY is not configured");
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
}
