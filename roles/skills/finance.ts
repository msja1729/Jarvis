import type { Skill } from './types.js';

export const FINANCE_SKILLS: Skill[] = [
  {
    id: 'budget',
    when: 'making a budget, tracking spending or saving money',
    body: `Budgeting from the user's real numbers:
1. Read Profile/Cash flow.md and Profile/Balance sheet.md. Ask only for what is missing that matters (take-home pay, fixed costs, debts, goals, currency).
2. Pick a method that fits: 50/30/20 as a starting point, zero-based for tight months, pay-yourself-first (automatic transfer on payday) for savers.
3. Emergency fund first: months covered = emergency fund ÷ essential monthly costs (Reference/Formulas.md); aim for 3-6 (1 to start for students).
4. Build the budget as a table (category, planned, actual, difference); point out the 2-3 categories with the biggest savings potential and give concrete cuts with amounts.
5. With a bank statement (CSV or PDF), categorise transactions, total by category, find recurring subscriptions and unusual spending.
6. Update Profile/Cash flow.md (with the date and savings rate) and save the budget to Budgets/<YYYY-MM> budget.md. Offer a monthly check-in reminder through the PA.`,
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
    body: `Investing (education, not personal advice):
1. Read Profile/Investment policy.md first. If it is empty, offer to build it with the investment-policy skill before recommending anything.
2. Order of operations: emergency fund → high-interest debt paid → insurance (health; term life with dependants) → invest for goals.
3. Goal by goal: amount, date, risk tolerance. Under 3 years → safe options; over 5-7 years → mostly diversified equity, per their policy.
4. Asset allocation drives most of the outcome; low-cost diversified index funds are a sensible default (check expense ratio, tracking error); regular monthly investing smooths timing.
5. Show compounding with Reference/Formulas.md at conservative and typical returns, after inflation.
6. If the user wants to act on fear or hype (sell in a fall, chase a tip), compare it with their policy's "rules for bad days" and say so plainly.
7. Warn about guaranteed high returns, social-media tips, timing the market, concentration in one stock, crypto risk, products mixing insurance and investing.
8. Country rules change: check official sources (focus "official"), save them dated in Reference/Rates and rules.md. For big decisions suggest a licensed, fee-only adviser.`,
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
    body: `Tax basics (general information; rules depend on country and year):
1. Check Reference/Rates and rules.md: use figures checked in the last 12 months for this country and year; otherwise look them up.
2. Ask the country (and state), whether the user is salaried, self-employed or a student, and the tax year.
3. Search official sources (web focus "official": the tax department's site), cite the page, and add each figure to Rates and rules.md with the date and link.
4. Explain taxable income, deductions they may qualify for, and documents to collect; show a worked estimate with their numbers and assumptions.
5. Ask the PA (team tool) to add filing and payment deadlines as reminders.
6. Complex cases (business or foreign income, capital gains, tax notices) → a qualified tax professional.`,
  },
  {
    id: 'purchase-evaluator',
    when: 'the user is deciding whether to buy something big or subscribe to something',
    body: `Purchase evaluator (should I buy this?):
1. Read Profile/Cash flow.md and Profile/Balance sheet.md. Ask for the price, how it will be paid (cash, EMI, card) and what it is for, if missing.
2. Affordability: price as a share of monthly take-home; months of savings it uses; effect on the emergency fund (months covered before and after).
3. Opportunity cost (Reference/Formulas.md): what the money would grow to if invested instead, at a conservative and a typical return, over 5 and 10 years.
4. If on EMI or card: total interest paid, and the new debt-to-income ratio.
5. Cost per use (price ÷ expected uses) and cheaper ways to get most of the value (second-hand, older model, renting, waiting for a sale).
6. Check it against their goals in Investment policy.md: does it delay one, and by how long?
7. Give a clear verdict (buy now / wait until X / skip) with the 2-3 numbers that decide it. It is their money: respect the choice once they have the facts.`,
  },
  {
    id: 'investment-policy',
    when: 'setting up or reviewing the user’s own investment rules',
    body: `Investment policy (the user's own rulebook, written while calm):
1. Interview briefly: goals (what, how much, by when), time horizon, how they would feel and act if investments fell 20-30%, income stability, existing investments and debts.
2. Propose a target allocation that fits horizon and risk (e.g. equity / debt / gold / cash), with the reasoning in one line each.
3. Add a rebalancing rule (yearly, or when an asset class is 5 points off target) and how new money is invested.
4. Write "rules for bad days": what they promise not to do in a market fall or a hype rally (e.g. no selling in a fall without a 2-week pause and a call with Victor).
5. Save it to Profile/Investment policy.md, dated. Review it yearly or after big life changes (new job, marriage, child, home).
6. This is education and structure, not regulated advice; for big sums suggest a licensed, fee-only adviser.`,
  },
];
