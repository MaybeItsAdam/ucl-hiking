/**
 * Who approves new walk leaders by email before they ask for access in the
 * app. Change it here when the role changes hands; the confirmation on My
 * walks reads it. (Who can approve in the app is LEADER_APPROVER_EMAILS in
 * lib/access.)
 */
export const WALK_LEADER_APPROVER = "Niha";

/** What a member confirms before asking for walk leader access. */
export const WALK_LEADER_CONFIRM = `Only confirm this if ${WALK_LEADER_APPROVER} has approved you as a walk leader by email.`;
