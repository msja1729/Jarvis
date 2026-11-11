import type { Skill } from './types.js';

export const DOCTOR_SKILLS: Skill[] = [
  {
    id: 'symptom-check',
    when: 'the user describes a symptom or feels unwell',
    body: `Symptom check (structured history, like a careful GP):
1. Red flags first: check Reference/Red flags.md. If any fits, stop and tell them to call emergency services or a doctor now, kindly and clearly. No home advice first.
2. Context from Profile/Health profile.md: age, conditions, medicines, allergies, pregnancy. Ask for what is missing only if it matters here.
3. OPQRST, one or two questions at a time (never a long questionnaire): Onset (when, sudden or gradual), Provocation/palliation (what makes it worse or better), Quality (what it feels like), Region/radiation (where, does it spread), Severity (0-10, effect on sleep and daily life), Time (constant or comes and goes, getting better or worse). Plus associated symptoms and recent travel, food, injury or new medicines.
4. Give 2-4 likely explanations in plain words, most likely first, and what would make each more or less likely. Never certain.
5. Triage clearly: Emergency now / See a doctor today / Book a visit within a few days / Self-care.
6. Self-care: concrete, safe steps and what not to do (painkillers only per the pack label and the user's conditions).
7. Safety net: "Get help sooner if ..." with specific signs and a time limit.
8. Sources on request (web focus "health", 1-3 named authorities).
9. Save a dated note in Health notes/, and add lasting facts (a diagnosis, a new medicine) to Profile/Health profile.md.`,
  },
  {
    id: 'lab-report',
    when: 'explaining blood tests, scans or any medical report',
    body: `Reading a medical report, against the user's own history:
1. Read the whole report (documents or files tool). Note the lab's printed ranges: they win over Reference/Lab ranges.md.
2. Append every value to Profile/Biomarkers.csv with the files tool (write, mode "append"): date of the test, marker, value, unit, lab_low, lab_high, lab, notes. This includes values the user only tells you ("my HbA1c is 6.1"); ask the date if unknown. One row per value; never rewrite old rows.
3. Compare each value with the user's own earlier results in Biomarkers.csv: is it stable, rising or falling, and since when? A change inside the normal range can still matter (e.g. HbA1c 5.2 → 5.6 → 5.9 over two years).
4. Lead with the overall picture in one or two sentences, then each abnormal or clearly changing value: plain name, value vs range and vs their last result, how far off, common harmless and important causes, what usually happens next.
5. Read patterns, not single numbers (anaemia: Hb with MCV and ferritin; diabetes risk: fasting glucose with HbA1c; heart risk: LDL with blood pressure, smoking and diabetes; thyroid: TSH with free T4; kidney: creatinine with eGFR and urine albumin).
6. Urgent values (see the end of Lab ranges.md): tell them to contact their doctor today.
7. End with: questions to ask their doctor, lifestyle steps that really move these numbers, and when to repeat the test. Never change prescribed medicine.
8. Update Profile/Health profile.md if the report shows something lasting.`,
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
