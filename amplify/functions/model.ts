// Shared Bedrock model identifiers for the two AI Lambdas (analyze-menu, chat).
//
// We invoke Claude Sonnet 4.6 through the `jp.` cross-region inference profile.
// Newer Claude models on Bedrock cannot be invoked by their base model id on
// demand in ap-northeast-1 — you must target the regional inference profile.
// (This is the "region prefix" gotcha called out in the project handoff.)
export const MODEL_ID = 'jp.anthropic.claude-sonnet-4-6';

// The underlying foundation-model id. Used ONLY to scope the IAM InvokeModel
// permission in backend.ts — invoking a profile also checks access to the
// foundation model it routes to.
export const FOUNDATION_MODEL_ID = 'anthropic.claude-sonnet-4-6';
