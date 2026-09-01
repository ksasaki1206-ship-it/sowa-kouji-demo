export const RESIDENT_ACCESS_STATUS = Object.freeze({
  open:'open', unavailable:'unavailable', disabled:'disabled', closed:'closed'
});

const encodeBase64Url = bytes => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  if (typeof btoa === 'function') return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

export function generateResidentAccessToken(cryptoSource = globalThis.crypto) {
  if (!cryptoSource?.getRandomValues) throw new Error('このブラウザでは安全な入居者用URLを生成できません。');
  const bytes = new Uint8Array(24);
  cryptoSource.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function residentAccessStatus(item) {
  if (!item) return { status:RESIDENT_ACCESS_STATUS.unavailable, message:'この回答ページは利用できません。' };
  if (item.residentAccessEnabled === false) return { status:RESIDENT_ACCESS_STATUS.disabled, message:'この回答ページは現在利用できません。' };
  if (item.lifecycleStatus === 'cancelled' || item.status === '完了' || item.isArchived === true) {
    return { status:RESIDENT_ACCESS_STATUS.closed, message:'この案件の受付は終了しました。' };
  }
  return { status:RESIDENT_ACCESS_STATUS.open, message:'' };
}
