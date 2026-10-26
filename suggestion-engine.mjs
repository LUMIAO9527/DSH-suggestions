import { SUGGEST_SYSTEM, NOVELTY_SYSTEM, suggestionInput, parseSuggestionBatch, parseNoveltySelection } from './prompt-core.mjs';

/** Ranked candidate generation, with one bounded repair for an exhausted manual request. */
export async function generateSuggestions(complete, source, { manual = false, signal, timeoutMs = 25000, noveltyTimeoutMs = 3000 } = {}) {
  const budget = new AbortController();
  const cancel = () => budget.abort(signal.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => budget.abort(new Error('suggestion request timed out')), Math.min(35000, timeoutMs + noveltyTimeoutMs));
  let rejectedSuggestions = [];
  try {
    for (let attempt = 0; attempt < (manual ? 2 : 1); attempt++) {
      const input = { ...source, manual, rejectedSuggestions,
        ...(attempt ? { generationFeedback: 'The preceding candidates repeated offered requests or failed validation. Choose another concrete intent supported by the current exchange. Do not fill the list with paraphrases.' } : {}),
      };
      const raw = await complete({ system: SUGGEST_SYSTEM, input: suggestionInput(input), signal: budget.signal, maxTokens: 1600, temperature: manual ? 0.45 : 0.3 });
      signal?.throwIfAborted();
      let decision;
      try { decision = parseSuggestionBatch(raw, input); }
      catch (error) { if (manual && attempt === 0 && !budget.signal.aborted) continue; throw error; }
      if (decision.state !== 'ready') return { suggestion: '', candidates: [] };
      let candidates = decision.suggestions;
      if (candidates.length && source.previousSuggestions?.length) {
        // The whole ranked batch is checked in one call, so one duplicate does
        // not hide useful candidates from other intents. Review failure retains
        // the leading candidate; unreviewed alternatives are not cached.
        const review = new AbortController();
        const stopReview = () => review.abort(budget.signal.reason);
        if (budget.signal.aborted) stopReview();
        budget.signal.addEventListener('abort', stopReview, { once: true });
        const reviewTimer = setTimeout(() => review.abort(new Error('duplicate review timed out')), noveltyTimeoutMs);
        try {
          const judgement = await complete({ system: NOVELTY_SYSTEM, input: JSON.stringify({ conversation: JSON.parse(suggestionInput({ ...source, manual })), candidates, previousSuggestions: [...(source.previousSuggestions || []), ...rejectedSuggestions] }), signal: review.signal, maxTokens: 250, temperature: 0 });
          signal?.throwIfAborted();
          const keep = parseNoveltySelection(judgement, candidates.length);
          rejectedSuggestions = candidates.filter((_, index) => !keep.includes(index));
          candidates = keep.map(index => candidates[index]);
        } catch (error) {
          if (signal?.aborted) throw error;
          candidates = candidates.slice(0, 1);
        } finally { clearTimeout(reviewTimer); budget.signal.removeEventListener('abort', stopReview); }
      }
      if (candidates.length) return { suggestion: candidates[0], candidates };
      if (budget.signal.aborted) break;
    }
    return { suggestion: '', candidates: [] };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
