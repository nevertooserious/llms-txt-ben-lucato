import { describe, expect, it } from 'vitest';
import { LlmOutputRejectedError } from '@llms-txt/generator';
import { answerText } from './anthropic-llm-client';

describe('answerText', () => {
  it('returns the text of a finished answer, skipping thinking blocks', () => {
    const response = {
      stop_reason: 'end_turn',
      content: [{ type: 'thinking' }, { type: 'text', text: '{"summary":"Acme."}' }],
    };
    expect(answerText(response)).toBe('{"summary":"Acme."}');
  });

  it.each(['refusal', 'max_tokens'])('rejects an answer that stopped with %s', (stopReason) => {
    const response = { stop_reason: stopReason, content: [{ type: 'text', text: '{"summ' }] };
    expect(() => answerText(response)).toThrow(LlmOutputRejectedError);
  });
});
