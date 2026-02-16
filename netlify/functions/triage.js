import OpenAI from "openai";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    problem_statement: { type: "string", minLength: 10 },
    clarifying_questions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", minLength: 5 }
    },
    proposed_approach: {
      type: "array",
      minItems: 4,
      maxItems: 7,
      items: { type: "string", minLength: 5 }
    },
    recommended_tools: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 2 }
    },
    risks_and_privacy: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 5 }
    },
    next_steps: {
      type: "array",
      minItems: 4,
      maxItems: 7,
      items: {
        type: "string",
        minLength: 3,
        pattern: "^(Gather|Define|Identify|Review|Assess|Analyze|Map|Document|Implement|Automate|Configure|Create|Set|Establish|Build|Prototype|Pilot|Test|Deploy|Monitor|Measure|Train|Communicate|Schedule|Prioritize|Standardize|Integrate|Refine|Update|Validate|Draft|Run|Enable|Collect|Clean|Design|Plan|Decide|Align)\\b.*$"
      }
    }
  },
  required: [
    "problem_statement",
    "clarifying_questions",
    "proposed_approach",
    "recommended_tools",
    "risks_and_privacy",
    "next_steps"
  ]
};

const MAX_INPUT_CHARS = 8000;
const MAX_BODY_BYTES = 64 * 1024;
const DEBUG_ERRORS = String(process.env.DEBUG_ERRORS || "").toLowerCase() === "true";

function getRequestId(event) {
  const h = event?.headers || {};
  return h["x-nf-request-id"] || h["X-Nf-Request-Id"] || h["x-request-id"] || h["X-Request-Id"] || null;
}

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS"
    },
    body: JSON.stringify(bodyObj)
  };
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function validateTriageShape(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "Response is not an object.";

  const allowedKeys = [
    "problem_statement",
    "clarifying_questions",
    "proposed_approach",
    "recommended_tools",
    "risks_and_privacy",
    "next_steps"
  ];
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!allowedKeys.includes(k)) return `Unexpected property: ${k}`;
  }
  for (const k of allowedKeys) {
    if (!(k in obj)) return `Missing required property: ${k}`;
  }

  if (typeof obj.problem_statement !== "string" || obj.problem_statement.trim().length < 10) {
    return "problem_statement must be a string (minLength 10).";
  }

  function checkArray(field, minItems, maxItems, minLen, pattern) {
    const arr = obj[field];
    if (!Array.isArray(arr)) return `${field} must be an array.`;
    if (arr.length < minItems || arr.length > maxItems) return `${field} must have ${minItems}-${maxItems} items.`;
    for (const item of arr) {
      if (typeof item !== "string" || item.trim().length < minLen) return `${field} items must be strings (minLength ${minLen}).`;
      if (pattern && !pattern.test(item)) return `${field} items must match required pattern.`;
    }
    return null;
  }

  const nextStepsPattern = /^(Gather|Define|Identify|Review|Assess|Analyze|Map|Document|Implement|Automate|Configure|Create|Set|Establish|Build|Prototype|Pilot|Test|Deploy|Monitor|Measure|Train|Communicate|Schedule|Prioritize|Standardize|Integrate|Refine|Update|Validate|Draft|Run|Enable|Collect|Clean|Design|Plan|Decide|Align)\b.*$/;
  return (
    checkArray("clarifying_questions", 3, 5, 5) ||
    checkArray("proposed_approach", 4, 7, 5) ||
    checkArray("recommended_tools", 1, 10, 2) ||
    checkArray("risks_and_privacy", 1, 10, 5) ||
    checkArray("next_steps", 4, 7, 3, nextStepsPattern)
  );
}

function toHttpError(err) {
  const status = typeof err?.status === "number" ? err.status : null;
  if (status === 401 || status === 403) return { statusCode: 502, message: "LLM authentication failed." };
  if (status === 429) return { statusCode: 429, message: "Rate limited by LLM provider. Try again shortly." };
  if (status && status >= 500) return { statusCode: 502, message: "LLM provider error. Try again shortly." };
  return { statusCode: 502, message: "LLM request failed." };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      error: "Missing OPENAI_API_KEY environment variable."
    });
  }

  const requestId = getRequestId(event);
  if (event.body && typeof event.body === "string" && Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Request body too large.", requestId });
  }

  let payload;
  try {
    const bodyText = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
    const parsed = safeJsonParse(bodyText || "{}");
    if (!parsed.ok) {
      return jsonResponse(400, { error: "Invalid JSON body.", requestId });
    }
    payload = parsed.value || {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body.", requestId });
  }

  const userMessage = typeof payload.userMessage === "string" ? payload.userMessage : "";
  if (!userMessage.trim()) {
    return jsonResponse(400, { error: "Missing required field: userMessage", requestId });
  }
  if (userMessage.length > MAX_INPUT_CHARS) {
    return jsonResponse(400, {
      error: `Input is too long. Please keep it under ${MAX_INPUT_CHARS} characters.`,
      requestId
    });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt =
    "You are an assistant that produces structured JSON for ticket triage. " +
    "Return ONLY valid JSON matching the provided schema. Do not wrap in markdown. " +
    "Do not include the schema keys as literal text inside any string values. " +
    "The next_steps array must contain 4-7 items, and each item must start with an action verb (e.g., Gather, Define, Implement, Review).";

  try {
    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            "User message to triage:\n" +
            userMessage +
            "\n\nGenerate a response that matches the JSON schema exactly."
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "triage_response",
          schema: RESPONSE_SCHEMA,
          strict: true
        }
      }
    });

    const text = response.output_text;
    if (!text || typeof text !== "string") {
      return jsonResponse(502, {
        error: "No text output received from model.",
        requestId
      });
    }

    const parsedResult = safeJsonParse(text);
    if (!parsedResult.ok) {
      return jsonResponse(502, {
        error: "Model returned non-JSON output.",
        requestId,
        ...(DEBUG_ERRORS ? { model_output: text.slice(0, 2000) } : {})
      });
    }

    const parsedTriage = parsedResult.value;
    const shapeError = validateTriageShape(parsedTriage);
    if (shapeError) {
      return jsonResponse(502, {
        error: "Model returned an invalid response shape.",
        requestId,
        ...(DEBUG_ERRORS ? { details: shapeError, model_output: text.slice(0, 2000) } : {})
      });
    }

    return jsonResponse(200, parsedTriage);
  } catch (err) {
    const httpErr = toHttpError(err);
    return jsonResponse(httpErr.statusCode, {
      error: httpErr.message,
      requestId,
      ...(DEBUG_ERRORS ? { details: err?.message || String(err) } : {})
    });
  }
};
