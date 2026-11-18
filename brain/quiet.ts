// The single internal reply for a clock tick on which there is nothing to say. It settles the
// journal turn and any waiting clock, but is not a message to the owner. Keep this exact: old
// journal readers must be able to recognise the whole reply, never a prefix of real prose.
export const QUIET_REPLY = '[teneral: no reply]';
export const ROUND_LIMIT_REPLY = '[round limit reached; waiting for the next stimulus]';
// What ends a turn that went on in calls that do nothing (brain/loop.ts). Shown: unlike a quiet tick, nothing settled it.
export const NO_OP_REPLY = '[stopped: only calls that do nothing; waiting for the next stimulus]';
export const quietReply = (text: string): boolean => [QUIET_REPLY, ROUND_LIMIT_REPLY].includes(text.trim());
