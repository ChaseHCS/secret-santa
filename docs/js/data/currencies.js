// [ISO code, name, rough value in USD (only used to suggest gift-idea price tiers)]
export const CURRENCIES = [
  ['USD', 'US dollar', 1],
  ['EUR', 'Euro', 1.08],
  ['GBP', 'British pound', 1.27],
  ['CAD', 'Canadian dollar', 0.73],
  ['AUD', 'Australian dollar', 0.66],
  ['NZD', 'New Zealand dollar', 0.6],
  ['CHF', 'Swiss franc', 1.12],
  ['SEK', 'Swedish krona', 0.095],
  ['NOK', 'Norwegian krone', 0.093],
  ['DKK', 'Danish krone', 0.145],
  ['PLN', 'Polish złoty', 0.25],
  ['CZK', 'Czech koruna', 0.043],
  ['HUF', 'Hungarian forint', 0.0028],
  ['JPY', 'Japanese yen', 0.0067],
  ['CNY', 'Chinese yuan', 0.14],
  ['HKD', 'Hong Kong dollar', 0.128],
  ['SGD', 'Singapore dollar', 0.74],
  ['KRW', 'South Korean won', 0.00073],
  ['INR', 'Indian rupee', 0.012],
  ['PHP', 'Philippine peso', 0.017],
  ['MXN', 'Mexican peso', 0.055],
  ['BRL', 'Brazilian real', 0.19],
  ['ZAR', 'South African rand', 0.054],
  ['AED', 'UAE dirham', 0.27],
  ['ILS', 'Israeli shekel', 0.27],
  ['TRY', 'Turkish lira', 0.03],
];

export function approxUsd(amount, currency) {
  const row = CURRENCIES.find(([c]) => c === currency);
  if (!row || amount === null || amount === undefined) return null;
  return amount * row[2];
}
