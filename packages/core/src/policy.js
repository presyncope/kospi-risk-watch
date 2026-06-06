export const NON_ADVICE_NOTICE =
  'Observation-only risk monitoring. This dashboard does not provide investment advice, buy/sell recommendations, position sizing, or automated trading.';

export const MVP_GUARDRAILS = Object.freeze({
  automatedTrading: false,
  investmentAdvice: false,
  paidOrClosedData: false,
  productionDeployment: false,
  complexMachineLearning: false,
});

export function assertNonAdviceText(text) {
  const forbidden = [/\bbuy\b/i, /\bsell\b/i, /매수/, /매도/, /position\s*siz(e|ing)?/i, /포지션\s*사이즈/];
  return !forbidden.some((pattern) => pattern.test(text));
}
