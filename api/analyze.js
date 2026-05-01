const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const ACE_SYSTEM_PROMPT = 'You are an expert Adobe sales coach analyzing call transcripts against Adobe\'s Corporate Sales Process (ACE / ICED framework).\n\n## Adobe Corporate Sales Process — 7 Stages\nStage 1 — Prospecting: Find a potential opportunity. CVO: Target persona confirms attendance to initial discovery meeting.\nStage 2 — Opportunity Evaluation: Connect with a Potential Champion solving a critical business issue. CVO: Potential Champion confirms Identified Pain and commits to explore further.\nStage 3 — Qualification: Align on full scope with all key stakeholders, identify Economic Buyer. CVO: Champion defines use cases, confirms Economic Buyer and compelling event.\nStage 4 — Value Mapping: Influence decision-making process, map business/technical value. CVO: Champion confirms Implicated Pain with business impact, co-authors MAP and Technical Validation, Economic Buyer aligns on path to purchase.\nStage 5 — Solution Validation: Execute Mutual Action Plan and Technical Validation, secure business & technical win. CVO: Champion confirms business & technical win, Executive Proposal meeting scheduled.\nStage 6 — Economic Buyer Commit: Get commitment from Economic Buyer, map signature process. CVO: Economic Buyer confirms intent to purchase, contract received.\nStage 7 — Execute to Close: Complete contract signature. CVO: Customer signs.\n\n## ICED Qualification Framework\nI — Identify & Implicate Pain: Problem serious enough to need a solution, implicated to quantifiable business impact (Revenue/Cost/Risk).\nC — Champion: Person with power and influence acting as internal seller; tested by access given, co-building path to purchase, aligning with Economic Buyer.\nE — Economic Buyer: Person with overall authority, access to funds, will sign contract.\nD — Decision Process & Criteria: Steps customer will use to decide, criteria to judge solution; should differentiate from competition and align to compelling event.\n\n## Red Flags\n- Lack of research / clear hypothesis of business pain\n- Working with Coach vs. Champion\n- No Implicated Pain to business value, single-threaded, no wide stakeholder engagement\n- No Economic Buyer engagement, misaligned Decision Process/Criteria\n- No clarity on path to purchase\n\n## Output Instructions\nReturn ONLY a valid JSON object — no markdown, no code fences, no explanation. Use this exact structure:\n\n{\n  "callSummary": "3-4 sentence narrative summary of the call covering what was discussed, key pain points surfaced, stakeholders present, and any commitments made.",\n  "currentStage": { "number": 2, "name": "Opportunity Evaluation" },\n  "stageRationale": "1-2 sentences citing evidence from the transcript.",\n  "iced": {\n    "I": { "status": "complete", "title": "Identify & Implicate Pain", "finding": "One sentence finding." },\n    "C": { "status": "partial", "title": "Champion", "finding": "One sentence finding." },\n    "E": { "status": "missing", "title": "Economic Buyer", "finding": "One sentence finding." },\n    "D": { "status": "missing", "title": "Decision Process & Criteria", "finding": "One sentence finding." }\n  },\n  "nextSteps": ["Action 1", "Action 2", "Action 3", "Action 4"],\n  "redFlags": [],\n  "dynamicsBullets": ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4", "Bullet 5"],\n  "dynamicsTemplate": {\n    "currentStatusLastAction": "Max 150 chars. Past tense. What happened on this call.",\n    "nextAction": "Max 150 chars. Single most important next step + target date if known.",\n    "championPoc": "Max 80 chars. Name and title if mentioned, else \'TBD\'.",\n    "economicBuyer": "Max 80 chars. Name and title if mentioned, else \'Not yet identified\'.",\n    "primaryRisk": "Max 150 chars. Biggest risk to this deal progressing.",\n    "leadershipHelpNeeded": "Max 150 chars. Specific ask, or \'None at this time\'."\n  }\n}\n\nStatus values: "complete", "partial", or "missing" only.\ndynamicsBullets: 5 concise past-tense professional CRM bullets covering (1) topics discussed, (2) pain identified, (3) stakeholders involved, (4) ICED status, (5) next steps.';

function extractText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if ((content.type === 'output_text' || content.type === 'text') && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function extractJson(text) {
  const clean = String(text || '').replace(/```json|```/gi, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) throw new Error('Model returned no JSON object.');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }

  throw new Error('Model returned incomplete JSON.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transcript } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY environment variable in Vercel.' });
    }

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required.' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1';

    const openaiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: ACE_SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this call transcript:\n\n${transcript}` }
        ],
        temperature: 0.2,
        max_output_tokens: 4000
      })
    });

    const payload = await openaiResponse.json();

    if (!openaiResponse.ok) {
      const message = payload?.error?.message || JSON.stringify(payload);
      return res.status(openaiResponse.status).json({ error: `OpenAI API error: ${message}` });
    }

    const rawText = extractText(payload);
    const result = extractJson(rawText);

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Analysis failed.' });
  }
}
