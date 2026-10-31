export function sniff(buf: Buffer): { mime: string } | null {
  if (buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg' };
  return null;
}
export const safeName = (n: string) => n.replace(/[\\/]/g, '_').replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
export const DOC_KINDS = ['FDR_DOCUMENT', 'BANK_CONFIRMATION', 'RENEWAL_DOCUMENT', 'SUPPORTING', 'RELEASE_SUPPORT'] as const;
