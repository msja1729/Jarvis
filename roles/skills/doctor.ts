import type { Skill } from './types.js';

export const DOCTOR_SKILLS: Skill[] = [
  {
    id: 'symptom-check',
    when: 'the user describes a symptom or feels unwell',
    body: `Symptom check (structured history, like a careful GP):
1. Red flags first. If ANY is present, stop and tell them to call emergency services or go to the emergency department now: chest pain or pressure (especially with sweating, breathlessness or pain spreading to arm/jaw); trouble breathing; face drooping, arm weakness or slurred speech (stroke: FAST); sudden worst-ever headache; fainting; confusion; seizure; heavy bleeding; vomiting blood or black stools; severe allergic reaction (swelling of lips/tongue, wheeze); high fever with stiff neck or a rash that does not fade under a glass; severe abdominal pain; suicidal thoughts (give a crisis line); in children: floppy, not drinking, fewer wet nappies.
2. Ask only what changes the advice (2-4 questions at a time), using SOCRATES: Site, Onset (sudden or gradual, when), Character, Radiation, Associated symptoms, Time course, Exacerbating/relieving factors, Severity (0-10). Also age, pregnancy, long-term conditions, current medicines, allergies, recent travel.
3. Give 2-4 likely explanations in plain words, most likely first, and say what would make each more or less likely. Never state a diagnosis as certain.
4. Triage clearly: Emergency now / See a doctor today / Book a GP visit within a few days / Self-care at home.
5. Self-care: concrete, safe steps (fluids, rest, paracetamol per pack label if suitable, etc.) and what NOT to do.
6. Safety-net: "Get help sooner if …" with specific worsening signs and a time limit ("if not better in 3 days").
7. If they want sources, search the web with focus "health" and cite 1-3 authorities (NHS, Mayo Clinic, MedlinePlus, WHO).
8. Offer to save a short note to "Health notes/" (date, symptom, advice) so it can be tracked.`,
  },
  {
    id: 'lab-report',
    when: 'explaining blood tests, scans or any medical report',
    body: `Reading a medical report:
1. Read the whole report (documents or files tool). Note the lab's own reference ranges: ranges differ between labs, units and age/sex, so always compare to the range printed on the report.
2. Lead with the overall picture in one or two sentences ("Most results are normal; two need attention: …").
3. For each abnormal value: name in plain words, the value vs range, how far off (slightly / clearly / markedly), the common harmless and important causes, and what usually happens next. Ignore tiny deviations that are clinically meaningless and say so.
4. Look for patterns, not single numbers. Common panels:
   - CBC: low Hb + low MCV → iron deficiency likely; high MCV → B12/folate, alcohol, thyroid; WBC differential (neutrophils: bacterial; lymphocytes: viral); platelets.
   - Lipids: LDL is the main target; risk depends on age, BP, smoking, diabetes; HDL protective; triglycerides affected by fasting, sugar, alcohol.
   - Glucose: fasting ≥126 mg/dL (7.0 mmol/L) or HbA1c ≥6.5% suggests diabetes; 100-125 / 5.7-6.4% prediabetes (confirm with a repeat test).
   - Thyroid: high TSH with low/normal T4 → underactive; low TSH → overactive.
   - Liver (ALT, AST, ALP, GGT, bilirubin) and kidney (creatinine, eGFR, urea, electrolytes, urine albumin).
   - Vitamin D, B12, ferritin (ferritin also rises with inflammation).
5. End with: questions to ask their doctor, lifestyle steps that genuinely move these numbers, and whether a repeat test makes sense.
6. Never change prescribed medicine. Point out anything urgent (very high potassium, very low sodium or haemoglobin, troponin) as "contact your doctor today".
7. Offer to save a dated summary in "Health notes/Reports.md" so trends can be compared next time.`,
  },
  {
    id: 'nutrition-plan',
    when: 'diet, meals, weight, protein or what to eat',
    body: `Nutrition planning:
1. Know the person: age, sex, height, weight, activity, goal (lose, gain, maintain, energy, a condition), food culture and what they actually like, budget, cooking time, allergies, vegetarian/vegan, conditions (diabetes, high BP, kidney disease, pregnancy) and medicines. Check the Doctor's notes and "Health notes/" first.
2. Energy: Mifflin-St Jeor BMR (men 10W + 6.25H - 5A + 5; women … - 161) × activity (1.2 sedentary to 1.725 very active). For weight loss, about 300-500 kcal/day below; never below ~1,200 (women) / 1,500 (men) without medical supervision.
3. Protein 1.2-1.6 g/kg/day for active people and during weight loss (0.8 g/kg minimum; be careful with kidney disease). Spread over meals (20-40 g each).
4. Plate method: half vegetables/fruit, a quarter protein, a quarter whole grains; healthy fats; 25-30 g fibre; water first; limit sugary drinks, ultra-processed foods, and salt (<5 g/day).
5. Build real meals from their cuisine (e.g. dal, roti, sabzi, curd for an Indian kitchen), with portions in household measures, a simple shopping list, and 2-3 swaps instead of bans.
6. Diabetes: consistent carbs, low-GI foods, pair carbs with protein/fibre. High BP: DASH style, less salt. Pregnancy: folate, iron, avoid alcohol, raw fish and unpasteurised cheese.
7. Make it doable: one change per week; track with a simple log. Supplements only when there is a reason (vitamin D, B12 for vegans, iron if deficient).
8. Save the plan to "Health notes/Nutrition plan.md" when asked; ask the PA to add shopping or meal-prep reminders if useful.`,
  },
  {
    id: 'exercise-plan',
    when: 'workouts, fitness, steps, strength or getting active',
    body: `Exercise prescription (FITT):
1. Screen first: chest pain, fainting or breathlessness on effort, heart disease, uncontrolled BP, recent surgery, pregnancy, joint problems → suggest a doctor's check before hard exercise; start gentle.
2. Targets (WHO adults): 150-300 min/week moderate (brisk walk; can talk, not sing) or 75-150 min vigorous, plus muscle strengthening of all major groups on 2+ days, and less sitting. Older adults add balance training.
3. Plan with Frequency, Intensity (talk test or RPE 1-10), Time, Type. Begin below their current ability; increase total volume by about 10% a week.
4. Strength basics: squat, hinge (hip bridge/deadlift), push, pull, carry, core; 2-3 sets of 8-12 reps, stop 1-3 reps before failure; good form before load.
5. Each session: 5-10 min warm-up, main part, cool-down. Rest days matter; sleep and protein drive recovery.
6. Fit it into their week (check the calendar with the PA via the team tool if they want it scheduled) and keep it fun and realistic: a 3-day plan they will do beats a 6-day plan they won't.
7. Give the plan as a small weekly table, and save it to "Health notes/Exercise plan.md" on request.`,
  },
  {
    id: 'sleep-stress',
    when: 'sleep problems, tiredness, stress or anxiety',
    body: `Sleep and stress:
1. Rule out red flags: loud snoring with pauses in breathing or daytime sleepiness (sleep apnoea: see a doctor), low mood most days for 2+ weeks, thoughts of self-harm (give a crisis line and urge immediate help), panic with chest pain (treat as possible emergency first).
2. Sleep (CBT-I principles, the first-line treatment for insomnia): fixed wake-up time every day; go to bed only when sleepy; if awake >20 min, get up and do something calm in dim light; bed for sleep only; no screens 30-60 min before; caffeine none after early afternoon; alcohol worsens sleep; daylight in the morning; cool, dark, quiet room; short naps (<20 min) before 3 pm.
3. Stress: name the stressor; split into what they can control and what they cannot; one small next action; breathing 4-6 (inhale 4 s, exhale 6 s) for 3-5 min; regular exercise; talking to someone; limit news/social media.
4. Suggest a 2-week sleep diary (bedtime, wake time, awakenings, caffeine, exercise) saved in "Health notes/Sleep diary.md", then review patterns.
5. Persistent problems (>3 months, or affecting daily life) → see a doctor or a CBT-I/mental-health professional.`,
  },
  {
    id: 'medicine-info',
    when: 'questions about a medicine, dose, side effects or interactions',
    body: `Medicine information (inform, never prescribe):
1. Identify the exact medicine (generic name, strength, form) and why they take it. Check "Health notes/" for their medicine list and allergies.
2. Use trusted sources only: search the web with focus "health" (MedlinePlus, NHS, the drug's official leaflet, national formulary). Cite the source.
3. Explain: what it does, how and when to take it (with food or not), common side effects vs serious ones that need urgent help, important interactions (alcohol, grapefruit, other medicines, supplements like St John's wort), and what to do if a dose is missed (per leaflet).
4. Never tell them to start, stop or change a prescribed dose; say "ask your doctor or pharmacist" for that, and suggest a pharmacist for quick interaction checks.
5. Over-the-counter painkillers: state the label's maximum daily dose and the main cautions (paracetamol: liver, alcohol, combination products; ibuprofen: stomach, kidneys, asthma, pregnancy, blood thinners).
6. Overdose or a child swallowed medicine → poison control / emergency services now.
7. Offer to keep their medicine list in "Health notes/Medicines.md" and ask the PA to set dose or refill reminders.`,
  },
];
