import { describe, expect, test } from 'bun:test';
import { foregroundPrompt } from '../../body/prompt';

describe('foreground terminal prompt', () => {
  test('clock and inbox wakes reuse the existing input place', () => {
    const output: string[] = [];
    const prompt = foregroundPrompt(text => output.push(text));
    prompt.ready();
    for (let wake = 0; wake < 10; wake++) prompt.ready();
    expect(output).toEqual(['> ']);
  });

  test('a partially typed line is not interrupted by another prompt', () => {
    const output: string[] = [];
    const prompt = foregroundPrompt(text => output.push(text));
    prompt.ready();
    output.push('partial owner input');
    prompt.ready();
    expect(output).toEqual(['> ', 'partial owner input']);
  });

  test('a submitted line gets one fresh prompt after its answer', () => {
    const output: string[] = [];
    const prompt = foregroundPrompt(text => output.push(text));
    prompt.ready();
    prompt.submitted();
    prompt.ready();
    expect(output).toEqual(['> ']);
    prompt.answered();
    prompt.answered();
    prompt.ready();
    expect(output).toEqual(['> ', '> ']);
  });

  test('an unanswered line does not accumulate prompts on retries or wakes', () => {
    const output: string[] = [];
    const prompt = foregroundPrompt(text => output.push(text));
    prompt.ready();
    prompt.submitted();
    prompt.ready();
    prompt.ready();
    expect(output).toEqual(['> ']);
  });
});
