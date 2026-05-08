/**
 * Medical Code Constants
 *
 * LOINC, SNOMED CT, ICD-10, and drug name mappings for
 * classifying clinical records into BPH-relevant categories.
 */

import type { BPHDrugClass } from './types';

// ── LOINC Codes (Lab Tests) ─────────────────────────────────────────

export const LOINC = {
  PSA: '2857-1',
  HBA1C: '4548-4',
  URINALYSIS_PANEL: '24356-8',
  PVR: '9187-6',
  UROFLOW_QMAX: '80963-5',
  VOLUME_VOIDED: '9192-6',
} as const;

// ── SNOMED CT Codes (Conditions) ────────────────────────────────────

export const SNOMED = {
  DIABETES: '73211009',
  HYPERTENSION: '38341003',
  BPH: '266569009',
  BPH_ALT: '16940007',
} as const;

// ── ICD-10 Code Prefixes (Conditions) ───────────────────────────────

export const ICD10_PREFIXES = {
  DIABETES_TYPE1: 'E10',
  DIABETES_TYPE2: 'E11',
  DIABETES_OTHER: 'E13',
  HYPERTENSION: ['I10', 'I11', 'I12', 'I13', 'I14', 'I15'],
  BPH: 'N40',
} as const;

// ── BPH Drug Classifications ───────────────────────────────────────

interface DrugEntry {
  generic: string;
  brands: string[];
  class: BPHDrugClass;
}

export const BPH_DRUGS: DrugEntry[] = [
  // Alpha blockers
  { generic: 'tamsulosin', brands: ['flomax'], class: 'alpha_blocker' },
  { generic: 'alfuzosin', brands: ['uroxatral'], class: 'alpha_blocker' },
  { generic: 'silodosin', brands: ['rapaflo'], class: 'alpha_blocker' },
  { generic: 'doxazosin', brands: ['cardura'], class: 'alpha_blocker' },
  { generic: 'terazosin', brands: ['hytrin'], class: 'alpha_blocker' },

  // 5-alpha reductase inhibitors
  { generic: 'finasteride', brands: ['proscar', 'propecia'], class: 'five_ari' },
  { generic: 'dutasteride', brands: ['avodart'], class: 'five_ari' },

  // Anticholinergics
  { generic: 'oxybutynin', brands: ['ditropan'], class: 'anticholinergic' },
  { generic: 'tolterodine', brands: ['detrol'], class: 'anticholinergic' },
  { generic: 'solifenacin', brands: ['vesicare'], class: 'anticholinergic' },
  { generic: 'darifenacin', brands: ['enablex'], class: 'anticholinergic' },
  { generic: 'trospium', brands: ['sanctura'], class: 'anticholinergic' },
  { generic: 'fesoterodine', brands: ['toviaz'], class: 'anticholinergic' },

  // Beta-3 agonists
  { generic: 'mirabegron', brands: ['myrbetriq'], class: 'beta3_agonist' },
  { generic: 'vibegron', brands: ['gemtesa'], class: 'beta3_agonist' },
];

/** Map of all drug names (lower case) → DrugEntry for fast lookup */
export const DRUG_NAME_MAP: Map<string, DrugEntry> = (() => {
  const map = new Map<string, DrugEntry>();
  for (const drug of BPH_DRUGS) {
    map.set(drug.generic, drug);
    for (const brand of drug.brands) {
      map.set(brand, drug);
    }
  }
  return map;
})();

// ── BPH Procedure Keywords ─────────────────────────────────────────

export const BPH_PROCEDURE_KEYWORDS = [
  'turp',
  'transurethral resection',
  'holep',
  'holmium laser',
  'greenlight',
  'green light',
  'photoselective vaporization',
  'pvp',
  'urolift',
  'prostatic urethral lift',
  'rezum',
  'water vapor',
  'aquablation',
  'simple prostatectomy',
  'prostatectomy',
  'bladder outlet',
] as const;

// ── Condition Text Patterns ─────────────────────────────────────────

export const CONDITION_TEXT_PATTERNS = {
  diabetes: [
    'diabetes',
    'diabetic',
    'dm type',
    'dm2',
    'dm1',
    'type 2 dm',
    'type 1 dm',
    'hyperglycemia',
    'a1c',
  ],
  hypertension: [
    'hypertension',
    'hypertensive',
    'high blood pressure',
    'htn',
    'elevated blood pressure',
  ],
  // Includes BPH itself + closely-related GU conditions + comorbidities
  // and neurologic conditions that the BPH-study research team wants
  // surfaced when reviewing a participant's chart. Comorbidities like
  // diabetes / hypertension / obesity confound BPH outcomes; neurologic
  // conditions can mimic BPH via neurogenic bladder.
  //
  // NOTE on classification order: matchTextToCategory() in
  // condition-mapper.ts short-circuits on the FIRST matching category,
  // checking diabetes → hypertension → bph in that order. So diabetes
  // and hypertension still classify into their own buckets during
  // prefill — listing them here only affects isBphCondition() in the
  // Health tab, which uses these patterns to decide whether to show a
  // condition in the BPH-Related Conditions section.
  bph: [
    'benign prostatic hyperplasia',
    'benign prostatic hypertrophy',
    'enlarged prostate',
    'bph',
    'bladder outlet obstruction',
    'lower urinary tract symptoms',
    'luts',
    'prostate enlargement',
    // Related GU conditions
    'overactive bladder',
    'oab',
    'urinary retention',
    'urinary incontinence',
    'neurogenic bladder',
    'prostatitis',
    'prostate cancer',
    'bladder cancer',
    'urothelial carcinoma',
    'recurrent urinary tract infection',
    'recurrent uti',
    'hematuria',
    'nocturia',
    // Comorbidities that confound BPH outcomes
    'diabetes',
    'diabetic',
    'dm type',
    'dm1',
    'dm2',
    'hypertension',
    'hypertensive',
    'high blood pressure',
    'htn',
    'obesity',
    'obese',
    'morbid obesity',
    // Neurologic conditions (cause neurogenic bladder, mimic BPH)
    'spinal cord injury',
    'sci',
    'paraplegia',
    'quadriplegia',
    'tetraplegia',
    'spina bifida',
    'multiple sclerosis',
    "parkinson",
    'parkinsonism',
    'stroke',
    'cerebrovascular accident',
    'cva',
    'dementia',
    "alzheimer",
    'peripheral neuropathy',
    'diabetic neuropathy',
  ],
} as const;

// ── Lab Text Patterns ───────────────────────────────────────────────

export const LAB_TEXT_PATTERNS = {
  psa: ['psa', 'prostate specific antigen', 'prostate-specific antigen'],
  hba1c: ['hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'a1c', 'glycohemoglobin'],
  urinalysis: ['urinalysis', 'urine analysis', 'ua ', 'u/a'],
} as const;
