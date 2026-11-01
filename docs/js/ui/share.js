// Share helpers: native share sheet, mailto:, sms:, WhatsApp.

export function canNativeShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** @returns {Promise<'shared'|'cancelled'|'unsupported'>} */
export async function nativeShare({ title, text }) {
  if (!canNativeShare()) return 'unsupported';
  try {
    await navigator.share({ title, text });
    return 'shared';
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

export function mailtoHref(to, subject, body) {
  const addr = String(to || '').replace(/[?#&%]/g, encodeURIComponent);
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function smsHref(phone, body) {
  const num = String(phone || '').replace(/[^\d+]/g, '');
  // "?&body=" works on both iOS and Android.
  return `sms:${num}?&body=${encodeURIComponent(body)}`;
}

export function whatsappHref(phone, text) {
  const raw = String(phone || '').trim();
  const digits = raw.startsWith('+') || raw.startsWith('00') ? raw.replace(/\D/g, '').replace(/^00/, '') : '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
