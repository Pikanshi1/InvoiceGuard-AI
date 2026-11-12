export const PAYMENT_DESTINATION_PENDING_NOTE = "[system:payment-destination-pending-verification]";

export function isPaymentDestinationPendingVerification(note: string | null | undefined) {
  return note === PAYMENT_DESTINATION_PENDING_NOTE || note?.startsWith(`${PAYMENT_DESTINATION_PENDING_NOTE}\n`) === true;
}

export function markPaymentDestinationPending(note: string | null | undefined) {
  return note ? `${PAYMENT_DESTINATION_PENDING_NOTE}\n${note}` : PAYMENT_DESTINATION_PENDING_NOTE;
}

export function getPreservedVerificationNote(note: string | null | undefined) {
  if (note === PAYMENT_DESTINATION_PENDING_NOTE) return null;
  if (note?.startsWith(`${PAYMENT_DESTINATION_PENDING_NOTE}\n`)) return note.slice(PAYMENT_DESTINATION_PENDING_NOTE.length + 1) || null;
  return null;
}
