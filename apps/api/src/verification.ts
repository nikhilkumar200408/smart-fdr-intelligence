// Adapter seam for a FUTURE legitimate bank integration. No bank connectivity exists in this MVP.
export interface BankVerificationRequest { bank: string; fdrNumber: string; amount: number; maturityDate: string; }
export interface BankVerificationResult { confirmed: boolean; amount?: number; maturityDate?: string; reference: string; }
export interface BankVerificationAdapter {
  readonly name: string;
  readonly configured: boolean;
  verify(req: BankVerificationRequest): Promise<BankVerificationResult>;
}
/** Placeholder: always reports "not configured" and never fabricates a confirmation. */
export class NotConfiguredBankAdapter implements BankVerificationAdapter {
  readonly name = 'none';
  readonly configured = false;
  async verify(): Promise<BankVerificationResult> { throw new Error('No bank API is configured. Use manual authorized verification.'); }
}
let adapter: BankVerificationAdapter = new NotConfiguredBankAdapter();
export const getBankAdapter = () => adapter;
export const registerBankAdapter = (a: BankVerificationAdapter) => { adapter = a; }; // wire a real, approved integration here
