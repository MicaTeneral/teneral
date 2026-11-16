// The single internal reply for a clock tick on which there is nothing to say. It settles the
// journal turn and any waiting clock, but is not a message to the owner. Keep this exact: old
// journal readers must be able to recognise the whole reply, never a prefix of real prose.
export const QUIET_REPLY = '[teneral: no reply]';
export const quietReply = (text: string): boolean => text.trim() === QUIET_REPLY;
