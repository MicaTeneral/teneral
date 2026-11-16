/** One input place for the foreground terminal, not a new prompt after every wake. */
export type ForegroundPrompt = {
  /** Call when the loop is ready to accept a line; repeated calls are idempotent. */
  ready: () => void;
  /** The line just submitted occupies this input place until the reply is over. */
  submitted: () => void;
  /** Redraw the prompt only after an answer moved the terminal to a fresh line. */
  answered: () => void;
};

export function foregroundPrompt(write: (text: string) => void): ForegroundPrompt {
  let state: 'initial' | 'shown' | 'submitted' = 'initial';
  return {
    ready() { if (state === 'initial') { write('> '); state = 'shown'; } },
    submitted() { if (state === 'shown') state = 'submitted'; },
    answered() { if (state === 'submitted') { write('> '); state = 'shown'; } },
  };
}
