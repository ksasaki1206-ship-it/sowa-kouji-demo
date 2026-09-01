import qrcode from '../vendor/qrcode-generator/qrcode.mjs';

export function createQrSvg(text) {
  if (!text) throw new Error('QRコードにするURLがありません。');
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  return qr.createSvgTag({
    cellSize:5,
    margin:20,
    scalable:true,
    title:'入居者回答フォームのQRコード',
    alt:'スマートフォンで読み取ると入居者回答フォームを開きます。'
  });
}
