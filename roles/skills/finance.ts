import type { Skill } from './types.js';

export const FINANCE_SKILLS: Skill[] = [
  {
    id: 'budget',
    when: 'making a budget, tracking spending or saving money',
    body: `Budgeting:
1. Facts first: monthly take-home income (after tax), fixed costs (rent, EMIs, fees, insurance, subscriptions), variable spending, current savings, debts, and goals with dates. Ask for the country and currency.
2. Pick a method that fits them: 50/30/20 (needs/wants/savings and debt) as a starting point; zero-based (every unit of money gets a job) for tight months; pay-yourself-first (automatic transfer on payday) for savers.
3. Emergency fund first: 3-6 months of essential costs in a safe, easy-to-reach account; students and steady salaries can start with 1 month.
4. Build the budget as a table (category, planned, actual, difference) and show a chart. Point out the 2-3 categories with the biggest savings potential, with concrete cuts.
5. If they share a bank statement (CSV or PDF via documents), categorise transactions, total by category, and find recurring subscriptions and unusual spending.
6. Save to "Budgets/<YYYY-MM> budget.md" (or .csv) and offer a monthly check-in reminder through the PA.`,
  },
  {
    id: 'debt-payoff',
    when: 'loans, EMIs, credit cards or paying off debt',
    body: `Debt payoff:
1. List every debt: balance, interest rate (APR), minimum payment, fees, any penalty for early repayment.
2. EMI = P·r·(1+r)^n / ((1+r)^n − 1), with r the monthly rate and n the number of months. Show total interest paid over the loan.
3. Strategies: avalanche (extra money to the highest rate first: least interest) vs snowball (smallest balance first: quick wins, better motivation). Show both with numbers and let them choose.
4. Credit cards: pay the full statement balance; minimum-only payments are very expensive (show how long it would take).
5. Options to compare: prepaying vs investing (compare the loan rate after tax with a realistic, safe return), refinancing or balance transfer (fees, new rate), consolidating.
6. Warning signs (borrowing to pay debts, missed payments) → suggest a non-profit credit counsellor.`,
  },
  {
    id: 'investing-basics',
    when: 'investing, saving for goals, SIPs, stocks or funds',
    body: `Investing basics (education, not personal advice):
1. Order of operations: emergency fund → high-interest debt paid → insurance (health, term life if dependants) → invest for goals.
2. Goal by goal: amount, date, how much risk they can stand. Short (<3 years) → safe options (deposits, liquid/short-term debt funds); long (>5-7 years) → mostly diversified equity.
3. Asset allocation drives most of the outcome: a mix of equity and debt suited to horizon and risk; rebalance once a year.
4. Low-cost, diversified index funds/ETFs are a sensible default; check expense ratio, tracking error, and fund house reputation. Regular monthly investing (SIP) smooths timing.
5. Show compounding with numbers: FV of a monthly SIP = P·((1+r)^n − 1)/r·(1+r) with r monthly return; use conservative returns and show a range, and the effect of inflation.
6. Warn about: guaranteed high returns, tips from social media, timing the market, concentration in one stock, crypto risk, products mixing insurance and investment.
7. Country rules (tax-saving options, accounts, limits) change: check official sources with web search focus "official" and cite them. For big decisions suggest a licensed, fee-only adviser.`,
  },
  {
    id: 'business-analysis',
    when: 'a business idea, pricing, startup or company finances',
    body: `Business analysis:
1. Model the unit: price, variable cost per unit, contribution margin (price − variable cost) and margin %. Fixed costs per month. Break-even units = fixed costs / contribution per unit.
2. Customers: CAC (marketing and sales spend / new customers), LTV (average margin per customer per month × average months retained). Healthy: LTV/CAC ≥ 3, CAC payback < 12 months.
3. Market size (TAM/SAM/SOM) from the bottom up (number of reachable customers × price), not from top-down percentages.
4. Pricing: cost-plus as a floor, value-based as a target, competitor prices as a check; test tiers.
5. Build a simple 12-month projection with three scenarios (worst, base, best) and the key assumptions written down; show cash runway (cash / monthly burn).
6. Reading statements: income statement (revenue, gross margin, operating profit), balance sheet (cash, debt, working capital), cash flow (operating cash flow vs profit).
7. End with the 3 assumptions that matter most and the cheapest way to test each. Save to "Budgets/<business> analysis.md" if asked.`,
  },
  {
    id: 'tax-basics',
    when: 'taxes, tax filing, deductions or deadlines',
    body: `Tax basics (general information; rules depend on the country and year):
1. Ask the country (and state if relevant), whether they are salaried, self-employed or a student, and the tax year.
2. Search official sources with web search focus "official" (the tax department's site) for current slabs/brackets, deductions and filing deadlines; cite the page and say the year it applies to.
3. Explain clearly: taxable income, deductions/exemptions they might qualify for, which documents to collect (salary slips, interest certificates, investment proofs, receipts).
4. Show a simple worked estimate with their numbers and the assumptions.
5. Ask the PA (team tool) to add filing and payment deadlines as reminders.
6. For complex cases (business income, foreign income, capital gains, notices from the tax office) recommend a qualified tax professional.`,
  },
];
