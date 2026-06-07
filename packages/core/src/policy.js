export const NON_ADVICE_NOTICE =
  'Personal decision-support tool for KOSPI inverse positioning. It does not execute automated trading or route orders; the entry/exit/sizing guidance shown is an illustrative reference, and the final decision and responsibility rest with the user.';

export const MVP_GUARDRAILS = Object.freeze({
  automatedTrading: false,
  orderRouting: false,
  paidOrClosedData: false,
  productionDeployment: false,
  complexMachineLearning: false,
});

export function assertNonAdviceText(text) {
  const forbidden = [/\bbuy\b/i, /\bsell\b/i, /매수/, /매도/, /position\s*siz(e|ing)?/i, /포지션\s*사이즈/];
  return !forbidden.some((pattern) => pattern.test(text));
}
