/** Shared policy for the DSH UI and its companion MCP transport. */
/** The only states a decision may use; both parsers and both prompts read this list. */
export const SUGGESTION_STATES = Object.freeze(['ready', 'waiting', 'complete']);

export const LIMITS = Object.freeze({ answer: 32000, request: 12000, history: 1200, historyCount: 4, turns: 6, turnUser: 2400, turnAnswer: 3000, draft: 16000, context: 16000, suggestion: 200 });

/** One prompt per task: role and output contract stated once, every other line a
 * selection rule. No account of how to work through the input, and no restatement of
 * what the transport already separates (system channel vs. JSON payload). Examples
 * appear only where the state or the ranking is genuinely ambiguous. */
export const SUGGEST_SYSTEM = [
  'You write the user\'s next message in this conversation: one sentence, in the user\'s language and register, at most 200 characters, phrased as something the user types to the assistant.',
  'Aim, in this order: the unfinished part of the current request; a step already agreed; a concrete sharpening of what was just delivered (narrower, deeper, re-toned, tightened); a comparison or question that helps the user decide. A short message such as "继续" continues the goal as it stands, so later corrections and topic changes override earlier ones.',
  'Candidates stay answerable from this conversation plus general knowledge. Text already on the table — a draft, a plan, an explanation — can be sharpened or re-framed; a fact the conversation never established (name, number, contact, venue, approval) cannot be requested.',
  'At most two candidates, strongest first, each asking for different work. Concrete beats vague: name the part, aspect or change the message is about. Skip an intent already present in previousSuggestions or rejectedSuggestions. requestMode=alternative asks for a different angle on the same goal; generationFeedback explains why the last attempt was refused.',
  'state: ready — useful work remains; waiting — the next step needs the user\'s own facts, materials or yes; complete — the request is explicitly finished or fully satisfied.',
  'Output only {"state":"ready|waiting|complete","suggestions":["message","message"]}: ready carries one or two messages, waiting and complete carry [].',
  'Example — request "解释这个概念" answered without the promised formula -> {"state":"ready","suggestions":["把刚才提到的公式写出来。"]}',
  'Example — friendly-tone draft written, no contact details anywhere -> {"state":"ready","suggestions":["开头再自然一点。","把第二段写得更具体。"]}',
  'Example — "只给译文" answered -> {"state":"complete","suggestions":[]}',
].join('\n');

export const OPTIMIZE_SYSTEM = [
  '你是聊天输入框里的提示词编辑器：把 draft 改写成更清楚、更容易执行的说法，只输出改写后的输入本身。',
  '只改表达：语序、指代、连接、明确程度、语气。原意、语言、事实和全部限制条件保持不变。',
  '路径、文件名、URL、代码、数字原样照抄；含「不要」「禁止」「必须」「仅」「先…再…」的短句按原文保留。',
  '已经清楚的输入可以原样返回；context 只用来判断指代，不引入新的要求。',
  '不加解释、寒暄、引号、前缀或代码块，不替用户回答问题。',
].join('\n');

export const NOVELTY_SYSTEM = [
  'You rank candidate next-user-messages. Keep a candidate only when it is answerable from the conversation or general knowledge, plausible as the user\'s next move on the live goal, and a different intent from every previousSuggestions entry and from the other candidates — different topic, scope or deliverable, not different wording.',
  'Rank what you keep, strongest first. Drop a candidate that rephrases an earlier suggestion, revives an abandoned topic, contradicts a stated constraint, or redoes completed work.',
  'Output only {"keep":[0,2]}, zero-based indexes in rank order, or {"keep":[]} when none qualify.',
].join('\n');

function readDecision(raw, label) {
  try { return JSON.parse(unfence(raw)); } catch { throw new Error('invalid ' + label); }
}

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

export function parseNovelty(raw) {
  const decision = readDecision(raw, 'novelty decision');
  if (!isRecord(decision) || Object.keys(decision).length !== 1 || typeof decision.duplicate !== 'boolean') throw new Error('invalid novelty decision');
  return !decision.duplicate;
}

export function parseNoveltySelection(raw, count) {
  const decision = readDecision(raw, 'novelty decision');
  if (count === 1 && typeof decision?.duplicate === 'boolean') return parseNovelty(raw) ? [0] : [];
  if (!isRecord(decision) || Object.keys(decision).length !== 1 || !Array.isArray(decision.keep)
    || decision.keep.some(index => !Number.isInteger(index) || index < 0 || index >= count) || new Set(decision.keep).size !== decision.keep.length) throw new Error('invalid novelty selection');
  return decision.keep;
}

export function boundedText(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters; input was not truncated`);
  if (required && !text) throw new Error(`${name} is required`);
  return text;
}

// Context may be condensed, never the draft being edited. Preserve both the
// beginning (task/constraints) and the end (conclusion/unresolved work).
export function contextExcerpt(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= max) return text;
  const marker = '\n[…中间内容省略…]\n';
  const head = Math.floor((max - marker.length) * 0.4);
  return text.slice(0, head) + marker + text.slice(-(max - marker.length - head));
}

export function validateTurns(value = []) {
  if (!Array.isArray(value) || value.length > LIMITS.turns) throw new Error('invalid recentTurns');
  return value.map(turn => {
    if (!isRecord(turn) || Object.keys(turn).some(key => key !== 'user' && key !== 'assistant')) throw new Error('invalid recentTurns item');
    return { user: boundedText(turn.user, 'recentTurns user', LIMITS.turnUser, true), assistant: boundedText(turn.assistant, 'recentTurns assistant', LIMITS.turnAnswer) };
  });
}

export function suggestionInput({ assistantAnswer, userRequest = '', recentUserMessages = [], recentTurns = [], earlierUserMessages = [], previousSuggestions = [], manual = false, rejectedSuggestions = [], generationFeedback = '' }) {
  // Avoid spending the same context budget twice on the latest exchange.
  const turns = recentTurns.filter(turn => turn.user !== userRequest || turn.assistant !== assistantAnswer).slice(-LIMITS.turns);
  let remaining = 9000;
  const paired = [];
  for (let i = turns.length - 1; i >= 0 && remaining >= 200; i--) {
    const budget = Math.min(remaining, 3600);
    const user = contextExcerpt(turns[i].user, Math.min(LIMITS.turnUser, Math.floor(budget * 0.5)));
    const assistant = contextExcerpt(turns[i].assistant, Math.min(LIMITS.turnAnswer, budget - user.length));
    paired.unshift({ user, assistant });
    remaining -= user.length + assistant.length;
  }
  return JSON.stringify({
    requestMode: manual ? 'alternative' : 'automatic',
    ...(earlierUserMessages.length ? { earlierUserMessages: earlierUserMessages.slice(-4).map(text => contextExcerpt(text, 600)) } : {}),
    ...(paired.length ? { recentTurns: paired } : { recentUserMessages: recentUserMessages.slice(-LIMITS.historyCount).map(text => contextExcerpt(text, LIMITS.history)) }),
    userRequest: contextExcerpt(userRequest, 6000),
    assistantAnswer: contextExcerpt(assistantAnswer, 9000),
    ...(previousSuggestions.length ? { previousSuggestions: previousSuggestions.slice(-10) } : {}),
    ...(rejectedSuggestions.length ? { rejectedSuggestions: rejectedSuggestions.slice(-3) } : {}),
    ...(generationFeedback ? { generationFeedback } : {}),
  });
}

export function optimizeInput(draft, context = '') {
  boundedText(draft, 'draft', LIMITS.draft, true);
  return JSON.stringify({ draft, ...(context ? { context: contextExcerpt(context, 6000) } : {}) });
}

function unfence(text) {
  const value = String(text ?? '').trim();
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
}

const normalize = value => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const generic = /^(?:继续|继续吧|继续处理|继续完善|展开|展开说说|详细说说|再讲讲|举个例子|优化一下|还有呢|好的|好|可以|没问题|同意|确认|执行吧|continue|tell me more|go on)[。.!！?？\s]*$/i;
const filePattern = /[\p{L}\p{N}_-]+\.(?:md|csv|xlsx?|docx?|pdf|png|jpe?g|svg|json|ya?ml|m?js|tsx?|py|html|css|zip|cas|dat)\b/giu;

export function parseSuggestion(raw, source = {}) {
  let parsed;
  try { parsed = JSON.parse(unfence(raw)); } catch { throw new Error('suggestion is not complete JSON'); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'suggestions')) return parseSuggestionBatch(raw, source).suggestions[0] || '';
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Object.keys(parsed).some(key => key !== 'state' && key !== 'suggestion') || !SUGGESTION_STATES.includes(parsed.state) || typeof parsed.suggestion !== 'string') throw new Error('invalid suggestion decision');
    if (parsed.state !== 'ready') return '';
    parsed = parsed.suggestion.trim() ? [parsed.suggestion] : [];
  }
  if (!Array.isArray(parsed) || parsed.length > 1) throw new Error('expected zero or one suggestion');
  if (parsed.length === 0) return '';
  if (typeof parsed[0] !== 'string') throw new Error('suggestion must be a string');
  const value = parsed[0].trim();
  if (!value) return '';
  if (value.length < 4 || [...value].length > LIMITS.suggestion || /[\r\n]/.test(value) || !/[\p{L}\p{N}]/u.test(value)) throw new Error('suggestion has invalid length or format');
  if (generic.test(value) || /^(?:你可以|您可以|建议你|建议您|下一步提示词|用户下一步|as an assistant|you can\b)/i.test(value)) throw new Error('suggestion is generic or uses the assistant voice');
  if (source.userRequest && normalize(value) === normalize(source.userRequest)) throw new Error('suggestion repeats the current request');
  if ((source.previousSuggestions || []).some(text => normalize(value) === normalize(text))) return '';
  const context = `${source.userRequest || ''}\n${source.assistantAnswer || ''}\n${(source.recentUserMessages || []).join('\n')}\n${(source.recentTurns || []).map(turn => `${turn.user}\n${turn.assistant || ''}`).join('\n')}\n${(source.earlierUserMessages || []).join('\n')}`.toLowerCase();
  for (const file of value.match(filePattern) || []) {
    if (context && !context.includes(file.toLowerCase())) throw new Error('suggestion introduces an unknown file');
  }
  return value;
}

export function parseSuggestionBatch(raw, source = {}) {
  let parsed;
  try { parsed = JSON.parse(unfence(raw)); } catch { throw new Error('suggestion is not complete JSON'); }
  if (!parsed || Array.isArray(parsed) || !Object.hasOwn(parsed, 'suggestions')) {
    const suggestion = parseSuggestion(raw, source);
    return { state: suggestion ? 'ready' : parsed?.state || 'complete', suggestions: suggestion ? [suggestion] : [] };
  }
  const metadata = ['reasoning', 'rationale', 'reason'];
  if (Object.keys(parsed).some(key => !['state', 'suggestions', ...metadata].includes(key))
    || metadata.some(key => Object.hasOwn(parsed, key) && (typeof parsed[key] !== 'string' || parsed[key].length > 2000))
    || !SUGGESTION_STATES.includes(parsed.state)
    || !Array.isArray(parsed.suggestions) || parsed.suggestions.length > 3) throw new Error('invalid suggestion batch');
  if (parsed.state !== 'ready') {
    if (parsed.suggestions.length) throw new Error('abstention cannot contain suggestions');
    return { state: parsed.state, suggestions: [] };
  }
  const suggestions = [];
  let invalid;
  for (const item of parsed.suggestions) {
    try {
      const text = parseSuggestion(JSON.stringify([item]), { ...source, previousSuggestions: [...(source.previousSuggestions || []), ...(source.rejectedSuggestions || []), ...suggestions] });
      if (text) suggestions.push(text);
    } catch (error) { invalid = error; }
  }
  if (!suggestions.length && invalid) throw invalid;
  return { state: 'ready', suggestions };
}

function constraintsIn(draft) {
  const clauses = draft.split(/[，,。；;！!？?\n]/).map(text => text.trim()).filter(Boolean);
  return clauses.flatMap(clause => {
    const match = /不要|不能|不得|禁止|必须|务必|未经|仅(?:限|能|输出|修改|使用)|只(?:能|输出|修改|使用)|先[\s\S]*再|\b(?:must(?: not)?|never|do not|don't|only)\b/i.exec(clause);
    return match ? [clause.slice(match.index)] : [];
  });
}

export function parseRewrite(raw, draft) {
  let value = String(raw ?? '').trim();
  if ((value.startsWith('"') && value.endsWith('"'))) {
    try { const parsed = JSON.parse(value); if (typeof parsed === 'string') value = parsed; } catch { /* not a JSON string */ }
  }
  if (!value || value.length > LIMITS.draft * 2 || (/^```/.test(value) && !draft.trim().startsWith('```')) || /^(?:改写后的提示词|优化后的提示词|以下是(?:优化|改写))[:：]/.test(value)) throw new Error('model did not return a plain rewritten prompt');
  const normalized = normalize(value);
  for (const constraint of constraintsIn(draft)) {
    if (!normalized.includes(normalize(constraint))) throw new Error('rewritten prompt did not preserve an explicit constraint');
  }
  const numbers = draft.match(/\d+(?:\.\d+)?/g) || [];
  const outNumbers = new Set(value.match(/\d+(?:\.\d+)?/g) || []);
  for (const number of numbers) if (!outNumbers.has(number)) throw new Error('rewritten prompt changed an original number');
  const terms = [
    ...(draft.match(filePattern) || []),
    ...(draft.match(/https?:\/\/[^\s<>"'，。；]+/g) || []),
    ...(draft.match(/[A-Za-z]:[\\/][^\s"'`，。；;！？\n]+/g) || []),
    ...(draft.match(/(?<![\w:/])\/(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+/gu) || []),
    ...(draft.match(/```[\s\S]*?```/g) || []),
    ...(draft.match(/`[^`]+`/g) || []),
  ];
  for (const term of terms) if (!value.includes(term)) throw new Error('rewritten prompt changed a file, URL or literal');
  return value;
}

export function optimizeMaxTokens(draft) {
  return Math.min(16000, Math.max(1600, Math.ceil([...draft].length * 1.8) + 512));
}

export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason || new Error('request cancelled'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
