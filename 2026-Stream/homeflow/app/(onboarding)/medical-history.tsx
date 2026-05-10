/**
 * Medical History Screen
 *
 * Displays medical history pulled from Apple Health clinical records and demographics
 * and asks the patient to confirm their information section by section.
 *
 * Flow:
 *   1. Loading: fetch HealthKit demographics
 *      (falls back to mock data in dev mode if no records are connected)
 *   2. Reviewing: 4-step confirmation UI
 *      Step 0 — Demographics (age, sex, phone, ethnicity, race)
 *      Step 1 — Current Medications
 *      Step 2 — Surgical History
 *      Step 3 — Conditions
 *   3. Complete: show confirmation screen and navigate to baseline survey
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  Animated,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { OnboardingProgressBar, ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getDemographics } from '@/lib/services/healthkit/HealthKitClient';
import { getAllClinicalRecords } from '@/lib/services/healthkit';
import {
  buildMedicalHistoryPrefill,
  type MedicalHistoryPrefill,
} from '@/lib/services/fhir';
import { BPH_DRUGS } from '@/lib/services/fhir/codes';
import {
  saveConfirmedDemographicsPrefill,
  saveMedicalHistory,
  saveUserProfile,
} from '@/src/services/throneFirestore';
import { getAuth } from '@/src/services/firestore';
import { syncFhirPrefill } from '@/src/services/fhirPrefillSync';
import { ConsentService } from '@/lib/services/consent-service';

// ── Types ─────────────────────────────────────────────────────────────

type MedicalHistoryPhase = 'loading' | 'reviewing' | 'complete';

const STEP_TITLES = ['Demographics', 'Current Medications', 'Surgical History', 'Conditions'] as const;

const STEP_DESCRIPTIONS = [
  'Your basic information from Apple Health.',
  'Medications found in your health records.',
  'Past procedures found in your health records.',
  'Medical conditions found in your health records.',
] as const;

const SEX_OPTIONS = [
  'Male',
  'Female',
  'Intersex',
  'Prefer not to say',
] as const;

const ETHNICITY_OPTIONS = [
  'Hispanic or Latino',
  'Not Hispanic or Latino',
  'Prefer not to say',
] as const;

const RACE_OPTIONS = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'More than one race',
  'Prefer not to say',
] as const;

type DemoStage = 'ethnicity' | 'race' | 'done';
type PickerField = 'ethnicity' | 'race' | 'biologicalSex';

// Common patient-facing names for surgical procedures, matched by keyword
const PROCEDURE_COMMON_NAMES: { keywords: string[]; commonName: string }[] = [
  // BPH / prostate
  { keywords: ['transurethral resection', 'turp'], commonName: 'Prostate Resection' },
  { keywords: ['holmium laser enucleation', 'holep'], commonName: 'Laser Prostate Surgery' },
  { keywords: ['greenlight', 'green light', 'photoselective vaporization', 'pvp'], commonName: 'Laser Prostate Vaporization' },
  { keywords: ['prostatic urethral lift', 'urolift'], commonName: 'Prostate Lift' },
  { keywords: ['water vapor', 'rezum'], commonName: 'Steam Prostate Treatment' },
  { keywords: ['aquablation'], commonName: 'Water Jet Prostate Treatment' },
  { keywords: ['prostatectomy', 'prostate removal'], commonName: 'Prostate Removal' },
  // General urology
  { keywords: ['cystoscopy'], commonName: 'Bladder Scope Exam' },
  { keywords: ['transurethral resection of bladder', 'turbt'], commonName: 'Bladder Tumor Removal' },
  { keywords: ['lithotripsy', 'nephrolithotomy', 'ureteroscopy', 'kidney stone'], commonName: 'Kidney Stone Surgery' },
  // Abdominal / GI
  { keywords: ['appendectomy', 'appendix'], commonName: 'Appendix Removal' },
  { keywords: ['cholecystectomy', 'gallbladder'], commonName: 'Gallbladder Removal' },
  { keywords: ['colectomy', 'colon resection'], commonName: 'Colon Surgery' },
  { keywords: ['hernia'], commonName: 'Hernia Repair' },
  { keywords: ['colonoscopy'], commonName: 'Colonoscopy' },
  { keywords: ['gastrectomy', 'stomach resection'], commonName: 'Stomach Surgery' },
  // Orthopedic
  { keywords: ['total hip', 'hip arthroplasty', 'hip replacement'], commonName: 'Hip Replacement' },
  { keywords: ['total knee', 'knee arthroplasty', 'knee replacement'], commonName: 'Knee Replacement' },
  { keywords: ['shoulder arthroplasty', 'shoulder replacement'], commonName: 'Shoulder Replacement' },
  { keywords: ['spinal fusion'], commonName: 'Spinal Fusion' },
  { keywords: ['laminectomy', 'discectomy', 'microdiscectomy'], commonName: 'Back Surgery' },
  { keywords: ['carpal tunnel'], commonName: 'Carpal Tunnel Release' },
  // Cardiac / vascular
  { keywords: ['coronary artery bypass', 'cabg', 'bypass graft'], commonName: 'Heart Bypass Surgery' },
  { keywords: ['cardiac catheterization', 'coronary angiography'], commonName: 'Heart Catheterization' },
  { keywords: ['pacemaker'], commonName: 'Pacemaker Implant' },
  { keywords: ['valve replacement', 'valvuloplasty'], commonName: 'Heart Valve Surgery' },
  // Eye / ENT
  { keywords: ['cataract'], commonName: 'Cataract Surgery' },
  { keywords: ['tonsillectomy', 'tonsil'], commonName: 'Tonsil Removal' },
  { keywords: ['adenoidectomy', 'adenoid'], commonName: 'Adenoid Removal' },
  { keywords: ['septoplasty', 'rhinoplasty'], commonName: 'Nasal Surgery' },
  // Thyroid / endocrine
  { keywords: ['thyroidectomy', 'thyroid'], commonName: 'Thyroid Removal' },
  { keywords: ['parathyroidectomy'], commonName: 'Parathyroid Removal' },
  // Reproductive
  { keywords: ['hysterectomy', 'uterus removal'], commonName: 'Uterus Removal' },
  { keywords: ['oophorectomy', 'ovary removal'], commonName: 'Ovary Removal' },
  { keywords: ['vasectomy'], commonName: 'Vasectomy' },
  { keywords: ['circumcision'], commonName: 'Circumcision' },
  // Breast / skin
  { keywords: ['mastectomy', 'breast removal'], commonName: 'Breast Removal' },
  { keywords: ['lumpectomy'], commonName: 'Breast Lump Removal' },
];

function getCommonProcedureName(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const entry of PROCEDURE_COMMON_NAMES) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry.commonName;
    }
  }
  return undefined;
}

type EditableMedItem = {
  id: string;
  name: string;        // scientific name + dosage (e.g., "tamsulosin 0.4 mg oral capsule")
  brandName?: string;  // capitalized brand name if found (e.g., "Flomax")
  groupKey: string;
};
type EditableProcItem = {
  id: string;
  name: string;        // scientific/FHIR name (e.g., "Transurethral Resection of the Prostate")
  commonName?: string; // patient-friendly label (e.g., "Prostate Resection")
  date?: string;
  isBPH: boolean;
};

type EditableCondItem = {
  id: string;
  name: string;
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatShortDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Shared sub-components (module-level to prevent remount on re-render) ──────
//
// IMPORTANT: These must live outside MedicalHistoryScreen. Defining components
// inside the parent function gives them a new reference on every render, which
// causes React to unmount/remount them (losing TextInput focus on each keystroke).

type RowColors = { icon: string; text: string };

function DataRow({
  label,
  value,
  found,
  placeholder = 'will ask',
  showBadge = true,
  onPress,
  actions,
  colors,
  borderColor,
}: {
  label: string;
  value: string | null | undefined;
  found: boolean;
  placeholder?: string;
  showBadge?: boolean;
  onPress?: () => void;
  actions?: React.ReactNode;
  colors: RowColors;
  borderColor: string;
}) {
  const inner = (
    <>
      <Text style={[reviewStyles.dataLabel, { color: colors.icon }]}>{label}</Text>
      <View style={reviewStyles.dataRight}>
        {found && value ? (
          <>
            <Text style={[reviewStyles.dataValue, { color: colors.text }]}>{value}</Text>
            {showBadge && (
              <View style={reviewStyles.sourceBadge}>
                <Text style={reviewStyles.sourceBadgeText}>Apple Health</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={[reviewStyles.willAskText, { color: colors.icon }]}>
            {placeholder}
          </Text>
        )}
        {actions}
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[reviewStyles.dataRow, { borderBottomColor: borderColor }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[reviewStyles.dataRow, { borderBottomColor: borderColor }]}>
      {inner}
    </View>
  );
}

function InlineInputRow({
  label,
  value,
  onChange,
  onSubmit,
  keyboardType = 'default',
  autoFocus: af = true,
  placeholder = 'Type here…',
  autoCapitalize = 'words',
  actions,
  colors,
  borderColor,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'email-address' | 'phone-pad';
  autoFocus?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  actions?: React.ReactNode;
  colors: RowColors;
  borderColor: string;
}) {
  return (
    <View style={[reviewStyles.dataRow, { borderBottomColor: borderColor }]}>
      <Text style={[reviewStyles.dataLabel, { color: colors.icon }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        autoFocus={af}
        keyboardType={keyboardType}
        style={[reviewStyles.inlineInput, { color: colors.text }]}
        placeholderTextColor={colors.icon}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
      {actions}
    </View>
  );
}

function SelectDataRow({
  label,
  onPress,
  actions,
  colors,
  borderColor,
}: {
  label: string;
  onPress: () => void;
  actions?: React.ReactNode;
  colors: RowColors;
  borderColor: string;
}) {
  return (
    <TouchableOpacity
      style={[reviewStyles.dataRow, { borderBottomColor: borderColor }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text style={[reviewStyles.dataLabel, { color: colors.icon }]}>{label}</Text>
      <View style={reviewStyles.dataRight}>
        <Text style={[reviewStyles.selectHint, { color: StanfordColors.cardinal }]}>
          Tap to select
        </Text>
        {actions}
        <IconSymbol name="chevron.right" size={13} color={StanfordColors.cardinal} />
      </View>
    </TouchableOpacity>
  );
}

function RowActionIcons({
  checked = false,
  rejected = false,
  onEdit,
  onConfirm,
  onReject,
  showEdit = true,
}: {
  checked?: boolean;
  rejected?: boolean;
  onEdit?: () => void;
  onConfirm?: () => void;
  onReject?: () => void;
  showEdit?: boolean;
}) {
  return (
    <View style={reviewStyles.rowActions}>
      {showEdit && onEdit ? (
        <TouchableOpacity
          style={reviewStyles.actionButton}
          onPress={onEdit}
          activeOpacity={0.7}
        >
          <IconSymbol name="pencil" size={18} color={StanfordColors.cardinal} />
        </TouchableOpacity>
      ) : null}
      {onConfirm ? (
        <TouchableOpacity
          style={[
            reviewStyles.actionButton,
            checked ? reviewStyles.actionButtonConfirmed : null,
          ]}
          onPress={onConfirm}
          activeOpacity={0.7}
        >
          <IconSymbol
            name={(checked ? 'checkmark.circle.fill' : 'circle') as any}
            size={20}
            color={checked ? '#34C759' : StanfordColors.cardinal}
          />
        </TouchableOpacity>
      ) : null}
      {onReject ? (
        <TouchableOpacity
          style={[
            reviewStyles.actionButton,
            rejected ? reviewStyles.actionButtonRejected : null,
          ]}
          onPress={onReject}
          activeOpacity={0.7}
        >
          <IconSymbol
            name={(rejected ? 'xmark.circle.fill' : 'xmark.circle') as any}
            size={20}
            color={rejected ? '#D93025' : StanfordColors.cardinal}
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────

export default function MedicalHistoryScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [phase, setPhase] = useState<MedicalHistoryPhase>('loading');
  const [reviewStep, setReviewStep] = useState(0);
  const [prefillData, setPrefillData] = useState<MedicalHistoryPrefill | null>(null);

  // Demographics sequential input state
  const [demoName, setDemoName] = useState('');
  const [demoPhone, setDemoPhone] = useState('');
  const [demoAge, setDemoAge] = useState('');
  const [demoBiologicalSex, setDemoBiologicalSex] = useState('');
  const [demoEthnicity, setDemoEthnicity] = useState('');
  const [demoRace, setDemoRace] = useState('');
  const [demoStage, setDemoStage] = useState<DemoStage>('ethnicity');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerField, setPickerField] = useState<PickerField>('ethnicity');

  // Editable medication/procedure items (local copies initialized from prefill)
  const [editableMeds, setEditableMeds] = useState<EditableMedItem[]>([]);
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [editingMedValue, setEditingMedValue] = useState('');
  const [otherMeds, setOtherMeds] = useState<EditableMedItem[]>([]);
  const [editableProcs, setEditableProcs] = useState<EditableProcItem[]>([]);
  const [editingProcId, setEditingProcId] = useState<string | null>(null);
  const [editingProcValue, setEditingProcValue] = useState('');

  const [otherConds, setOtherConds] = useState<EditableCondItem[]>([]);
  const [editableHealthConds, setEditableHealthConds] = useState<EditableCondItem[]>([]);
  const [editingCondId, setEditingCondId] = useState<string | null>(null);
  const [editingCondValue, setEditingCondValue] = useState('');

  const [confirmedDemoFields, setConfirmedDemoFields] = useState<Set<string>>(new Set());
  const [confirmedMedIds, setConfirmedMedIds] = useState<Set<string>>(new Set());
  const [rejectedMedIds, setRejectedMedIds] = useState<Set<string>>(new Set());
  const [confirmedProcIds, setConfirmedProcIds] = useState<Set<string>>(new Set());
  const [rejectedProcIds, setRejectedProcIds] = useState<Set<string>>(new Set());
  const [confirmedCondIds, setConfirmedCondIds] = useState<Set<string>>(new Set());
  const [rejectedCondIds, setRejectedCondIds] = useState<Set<string>>(new Set());

  const stepFade = useRef(new Animated.Value(1)).current;
  const confirmFade = useRef(new Animated.Value(0)).current;
  // Tracks last-tap timestamps per field for double-tap detection
  const lastTapTimes = useRef<Record<string, number>>({});
  const ageIsAutoPopulated = prefillData?.demographics.age.confidence !== 'none'
    && prefillData?.demographics.age.value != null;
  const biologicalSexIsAutoPopulated = prefillData?.demographics.biologicalSex.confidence !== 'none'
    && !!prefillData?.demographics.biologicalSex.value;
  // ── Load clinical records ─────────────────────────────────────────

  const loadPrefillData = useCallback(async () => {
    setPhase('loading');

    try {
      const [rawRecords, demographics] = await Promise.all([
        getAllClinicalRecords().catch((err) => {
          console.warn('[MedicalHistory] getAllClinicalRecords error:', err);
          return { medications: [], labResults: [], conditions: [], procedures: [] };
        }),
        getDemographics().catch(() => ({ age: null, dateOfBirth: null, biologicalSex: null })),
      ]);

      // Map HK ClinicalRecord[] → ClinicalRecordsInput (parser's expected shape)
      const clinicalRecords = {
        medications: rawRecords.medications.map((r) => ({
          displayName: r.displayName,
          fhirResource: r.fhirResource,
        })),
        labResults: rawRecords.labResults.map((r) => ({
          displayName: r.displayName,
          fhirResource: r.fhirResource,
        })),
        conditions: rawRecords.conditions.map((r) => ({
          displayName: r.displayName,
          fhirResource: r.fhirResource,
        })),
        procedures: rawRecords.procedures.map((r) => ({
          displayName: r.displayName,
          fhirResource: r.fhirResource,
        })),
      };

      const prefill = buildMedicalHistoryPrefill(clinicalRecords, demographics);

      setPrefillData(prefill);

      // Write prefill to Firestore now that we have live HealthKit data.
      // bootstrapHealthKitSync may have run before HealthKit clinical record
      // queries settled — this ensures the prefill is always persisted.
      syncFhirPrefill().catch((err) =>
        console.warn('[MedicalHistory] prefill sync error:', err),
      );

      // Build flat editable lists from the prefill, including non-BPH meds
      // pulled from Apple Health clinical records so the participant can confirm them too.
      const medGroupKeys = [
        'alphaBlockers',
        'fiveARIs',
        'anticholinergics',
        'beta3Agonists',
        'otherBPH',
        'otherMedications',
      ] as const;
      const medItems: EditableMedItem[] = [];
      for (const groupKey of medGroupKeys) {
        (prefill.medications[groupKey].value ?? []).forEach((m, i) => {
          const drugEntry = m.genericName
            ? BPH_DRUGS.find(d => d.generic === m.genericName!.toLowerCase())
            : undefined;
          const brandName = groupKey === 'otherMedications'
            ? undefined
            : (drugEntry?.brands[0] ? capitalize(drugEntry.brands[0]) : undefined);
          medItems.push({ id: `${groupKey}_${i}`, name: m.name, brandName, groupKey });
        });
      }
      setEditableMeds(medItems);
      setEditingMedId(null);
      setEditingMedValue('');

      const procItems: EditableProcItem[] = [];
      (prefill.surgicalHistory.bphProcedures.value ?? []).forEach((p, i) => {
        procItems.push({ id: `bph_${i}`, name: p.name, commonName: getCommonProcedureName(p.name), date: p.date, isBPH: true });
      });
      (prefill.surgicalHistory.otherProcedures.value ?? []).forEach((p, i) => {
        procItems.push({ id: `other_${i}`, name: p.name, commonName: getCommonProcedureName(p.name), date: p.date, isBPH: false });
      });
      setEditableProcs(procItems);
      setEditingProcId(null);
      setEditingProcValue('');

      setOtherConds([]);
      const conditionItems: EditableCondItem[] = [
        ...(prefill.conditions.diabetes.value ?? []),
        ...(prefill.conditions.hypertension.value ?? []),
        ...(prefill.conditions.bph.value ?? []),
        ...(prefill.conditions.other.value ?? []),
      ].map((cond, index) => ({
        id: `cond_${index}`,
        name: cond.name,
      }));
      setEditableHealthConds(conditionItems);
      setEditingCondId(null);
      setEditingCondValue('');

      setReviewStep(0);
      setConfirmedDemoFields(new Set());
      setConfirmedMedIds(new Set());
      setRejectedMedIds(new Set());
      setConfirmedProcIds(new Set());
      setRejectedProcIds(new Set());
      setConfirmedCondIds(new Set());
      setRejectedCondIds(new Set());
      setDemoPhone('');
      setDemoAge('');
      setDemoBiologicalSex('');
      setDemoEthnicity('');
      setDemoRace('');

      const consentRecord = await ConsentService.getConsentRecord();
      const consentName = consentRecord?.participantSignature;
      if (consentName && consentName !== '[Drawn signature provided]') {
        setDemoName(consentName);
        setDemoStage('ethnicity');
      } else {
        setDemoName('');
        setDemoStage('ethnicity');
      }

      setPhase('reviewing');
    } catch {
      setPhase('reviewing');
    }
  }, []);

  useEffect(() => {
    loadPrefillData();
  }, [loadPrefillData]);

  // ── Picker handler ────────────────────────────────────────────────

  const handlePickerSelect = useCallback((value: string) => {
    setPickerVisible(false);
    if (pickerField === 'ethnicity') {
      setDemoEthnicity(value);
      setDemoStage('race');
    } else if (pickerField === 'race') {
      setDemoRace(value);
      setDemoStage('done');
    } else {
      setDemoBiologicalSex(value);
    }
  }, [pickerField]);

  const openPicker = useCallback((field: PickerField) => {
    setPickerField(field);
    setPickerVisible(true);
  }, []);

  // Double-tap detection: call action() if two taps arrive within 300 ms
  const handleFieldDoubleTap = useCallback((key: string, action: () => void) => {
    const now = Date.now();
    const last = lastTapTimes.current[key] ?? 0;
    if (now - last < 300) {
      lastTapTimes.current[key] = 0;
      action();
    } else {
      lastTapTimes.current[key] = now;
    }
  }, []);

  const updateConfirmedSet = useCallback((
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const setResolutionState = useCallback((
    key: string,
    confirmedSetter: React.Dispatch<React.SetStateAction<Set<string>>>,
    rejectedSetter: React.Dispatch<React.SetStateAction<Set<string>>>,
    resolution: 'confirmed' | 'rejected',
  ) => {
    confirmedSetter(prev => {
      const next = new Set(prev);
      if (resolution === 'confirmed') {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      } else {
        next.delete(key);
      }
      return next;
    });

    rejectedSetter(prev => {
      const next = new Set(prev);
      if (resolution === 'rejected') {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const buildConfirmedConditions = useCallback(() => {
    return [
      ...editableHealthConds.filter(cond => confirmedCondIds.has(cond.id)),
      ...otherConds.filter(cond => confirmedCondIds.has(cond.id)),
    ]
      .map(cond => cond.name.trim())
      .filter(Boolean);
  }, [editableHealthConds, otherConds, confirmedCondIds]);

  const buildConfirmedMedicalHistoryPayload = useCallback(() => {
    if (!prefillData) return null;

    const rawAge = (ageIsAutoPopulated ? confirmedDemoFields.has('age') : !!demoAge.trim())
      ? (prefillData.demographics.age.value ?? (demoAge ? parseInt(demoAge, 10) : null))
      : null;
    const confirmedBiologicalSex = (biologicalSexIsAutoPopulated ? confirmedDemoFields.has('biologicalSex') : !!demoBiologicalSex.trim())
      ? (prefillData.demographics.biologicalSex.value ?? (demoBiologicalSex || null))
      : null;

    const deidentifyAge = (age: number | null): number | '90+' | null => {
      if (age === null) return null;
      return age >= 89 ? '90+' : age;
    };
    const yearOnly = (dateStr: string | null | undefined): string | undefined => {
      if (!dateStr) return undefined;
      const year = new Date(dateStr).getFullYear();
      return Number.isNaN(year) ? undefined : String(year);
    };
    return {
      demographics: {
        ethnicity: demoEthnicity,
        race: demoRace,
        age: deidentifyAge(rawAge),
        biologicalSex: confirmedBiologicalSex,
        dateOfBirth: null,
      },
      medications: [
        ...editableMeds.filter(m => confirmedMedIds.has(m.id)),
        ...otherMeds.filter(m => confirmedMedIds.has(m.id)),
      ].map(m => ({
        name: m.name,
        brandName: m.brandName,
        groupKey: m.groupKey,
      })),
      surgicalHistory: editableProcs
        .filter(p => confirmedProcIds.has(p.id))
        .map(p => ({
          name: p.name,
          commonName: p.commonName,
          date: yearOnly(p.date),
          isBPH: p.isBPH,
        })),
      conditions: buildConfirmedConditions().map(name => ({ name })),
      labs: {
        psa: null,
        hba1c: null,
        urinalysis: null,
      },
      clinicalMeasurements: {
        pvr: null,
        uroflowQmax: null,
        volumeVoided: null,
        mobility: prefillData.clinicalMeasurements.mobility.value ?? null,
      },
    };
  }, [
    prefillData,
    editableMeds,
    otherMeds,
    editableProcs,
    confirmedDemoFields,
    confirmedMedIds,
    confirmedProcIds,
    demoAge,
    demoBiologicalSex,
    demoEthnicity,
    demoRace,
    ageIsAutoPopulated,
    biologicalSexIsAutoPopulated,
    buildConfirmedConditions,
  ]);

  const persistConfirmedEntries = useCallback(async () => {
    const authUser = getAuth().currentUser;
    const uid = authUser?.uid;
    if (!uid || !prefillData) return;

    const normalizedName = demoName.trim();
    const normalizedPhone = demoPhone.trim();
    const normalizedEmail = authUser.email?.trim() || '';
    const includeFullName = !!normalizedName;
    const includePhone = !!normalizedPhone;
    const includeAge = ageIsAutoPopulated ? confirmedDemoFields.has('age') : !!demoAge.trim();
    const includeBiologicalSex = biologicalSexIsAutoPopulated
      ? confirmedDemoFields.has('biologicalSex')
      : !!demoBiologicalSex.trim();
    const includeEthnicity = !!demoEthnicity.trim();
    const includeRace = !!demoRace.trim();

    const profilePayload = {
      name: includeFullName ? normalizedName || authUser.displayName || undefined : undefined,
      displayName: includeFullName ? normalizedName || authUser.displayName || undefined : undefined,
      firstName: includeFullName && normalizedName ? normalizedName.split(/\s+/)[0] : undefined,
      lastName: includeFullName && normalizedName ? normalizedName.split(/\s+/).slice(1).join(' ') || undefined : undefined,
      email: normalizedEmail || undefined,
      phoneNumber: includePhone ? normalizedPhone || undefined : undefined,
    };

    saveUserProfile(uid, profilePayload).catch((err) => {
      console.warn('[MedicalHistory] Failed to save user profile:', err);
    });

    const demographicFieldsReady =
      includeAge && includeBiologicalSex && includeEthnicity && includeRace;

    if (demographicFieldsReady) {
      const rawAge = prefillData.demographics.age.value ?? (demoAge ? parseInt(demoAge, 10) : null);
      const confirmedBiologicalSex =
        prefillData.demographics.biologicalSex.value ?? (demoBiologicalSex || null);

      saveConfirmedDemographicsPrefill(uid, {
        fullName: normalizedName,
        age: rawAge,
        biologicalSex: confirmedBiologicalSex,
        ethnicity: demoEthnicity,
        race: demoRace,
      }).catch((err) => {
        console.warn('[MedicalHistory] Failed to save confirmed demographics prefill:', err);
      });
    }

    const payload = buildConfirmedMedicalHistoryPayload();
    if (payload) {
      saveMedicalHistory(uid, payload).catch((err) => {
        console.warn('[MedicalHistory] Failed to save to Firestore:', err);
      });
    }
  }, [
    prefillData,
    demoName,
    demoPhone,
    demoAge,
    demoBiologicalSex,
    demoEthnicity,
    demoRace,
    ageIsAutoPopulated,
    biologicalSexIsAutoPopulated,
    confirmedDemoFields,
    buildConfirmedMedicalHistoryPayload,
  ]);

  useEffect(() => {
    void persistConfirmedEntries();
  }, [persistConfirmedEntries]);

  // ── Save and navigate ─────────────────────────────────────────────

  const handleContinue = async () => {
    const confirmedMedications = [
      ...editableMeds.filter(med => confirmedMedIds.has(med.id)),
      ...otherMeds.filter(med => confirmedMedIds.has(med.id)),
    ];
    const confirmedProcedures = editableProcs.filter(proc => confirmedProcIds.has(proc.id));
    const conditions = buildConfirmedConditions();
    const medications = confirmedMedications.map(med => med.name);
    const surgicalHistory = confirmedProcedures.map(proc => proc.name);
    const bphTreatmentHistory = [
      ...confirmedMedications.map(med => med.name),
      ...confirmedProcedures.filter(proc => proc.isBPH).map(proc => proc.name),
    ];

    const demoSummary = [
      phoneReady && demoPhone && `Phone: ${demoPhone}`,
      ageReady && (prefillData.demographics.age.value ?? demoAge) && `Age: ${prefillData.demographics.age.value ?? demoAge}`,
      biologicalSexReady && (prefillData.demographics.biologicalSex.value ?? demoBiologicalSex) && `Sex: ${prefillData.demographics.biologicalSex.value ?? demoBiologicalSex}`,
      ethnicityReady && demoEthnicity && `Ethnicity: ${demoEthnicity}`,
      raceReady && demoRace && `Race: ${demoRace}`,
    ].filter(Boolean).join(', ');

    await OnboardingService.updateData({
      medicalHistory: {
        medications,
        conditions,
        allergies: [],
        surgicalHistory,
        bphTreatmentHistory,
        rawTranscript: `reviewed from health records${demoSummary ? ` | ${demoSummary}` : ''}`,
      },
    });

    await OnboardingService.goToStep(OnboardingStep.BASELINE_SURVEY);
    router.push('/(onboarding)/baseline-survey' as Href);
  };

  const handlePreviousStep = useCallback(() => {
    if (reviewStep === 0) {
      router.back();
      return;
    }

    Animated.timing(stepFade, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setReviewStep(prev => Math.max(0, prev - 1));
      Animated.timing(stepFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  }, [reviewStep, router, stepFade]);

  const handleNextStep = useCallback(() => {
    Animated.timing(stepFade, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
      }).start(() => {
      if (reviewStep < STEP_TITLES.length - 1) {
        setReviewStep(prev => prev + 1);
      } else {
        setPhase('complete');
        Animated.spring(confirmFade, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 8,
        }).start();
      }

      Animated.timing(stepFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  }, [reviewStep, stepFade, confirmFade]);

  const ageReady = ageIsAutoPopulated ? confirmedDemoFields.has('age') : !!demoAge.trim();
  const biologicalSexReady = biologicalSexIsAutoPopulated
    ? confirmedDemoFields.has('biologicalSex')
    : !!demoBiologicalSex.trim();
  const phoneReady = !!demoPhone.trim();
  const ethnicityReady = !!demoEthnicity.trim();
  const raceReady = !!demoRace.trim();

  const stepCanProceed = reviewStep === 0
    ? ageReady && biologicalSexReady && phoneReady && ethnicityReady && raceReady
    : reviewStep === 1
    ? [...editableMeds, ...otherMeds].every(item => confirmedMedIds.has(item.id) || rejectedMedIds.has(item.id))
    : reviewStep === 2
    ? editableProcs.every(item => confirmedProcIds.has(item.id) || rejectedProcIds.has(item.id))
    : [...editableHealthConds, ...otherConds].every(item => confirmedCondIds.has(item.id) || rejectedCondIds.has(item.id));

  // ── Shared style values ───────────────────────────────────────────

  const sectionBg = isDark ? '#2A2D2F' : '#FFFFFF';
  const borderColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  function ProcedureSection({ label, items }: { label: string; items: EditableProcItem[] }) {
    const isBPHSection = label.includes('BPH');
    return (
      <View style={reviewStyles.medGroup}>
        <Text style={[reviewStyles.medGroupLabel, { color: colors.icon }]}>{label}</Text>
        {items.length > 0 ? (
          items.map(item => (
            <View key={item.id} style={reviewStyles.medItem}>
              <Text style={[reviewStyles.medBullet, { color: StanfordColors.cardinal }]}>•</Text>
                      {editingProcId === item.id ? (
                        <TextInput
                          value={editingProcValue}
                          onChangeText={setEditingProcValue}
                          onSubmitEditing={() => {
                    const trimmed = editingProcValue.trim();
                    if (trimmed) {
                      setEditableProcs(prev => prev.map(p =>
                        p.id === item.id ? { ...p, name: trimmed } : p
                      ));
                    } else {
                      setEditableProcs(prev => prev.filter(p => p.id !== item.id));
                    }
                    setEditingProcId(null);
                  }}
                  returnKeyType="done"
                  autoFocus
                  style={[reviewStyles.medEditInput, { color: colors.text }]}
                />
              ) : (
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => handleFieldDoubleTap(`proc_${item.id}`, () => {
                    setEditingProcId(item.id);
                    setEditingProcValue(item.name);
                    setEditingMedId(null);
                  })}
                  activeOpacity={0.8}
                >
                  <View style={reviewStyles.procNameRow}>
                    {item.commonName ? (
                      <Text style={[reviewStyles.medName, { color: colors.text }]}>
                        {item.commonName}{' '}
                        <Text style={reviewStyles.medNameSecondary}>({item.name})</Text>
                      </Text>
                    ) : (
                      <Text style={[reviewStyles.medName, { color: colors.text }]}>{item.name}</Text>
                    )}
                    {item.date && (
                      <Text style={[reviewStyles.procDate, { color: colors.icon }]}>
                        {formatShortDate(item.date)}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
              {editingProcId !== item.id ? (
                <RowActionIcons
                  checked={confirmedProcIds.has(item.id)}
                  rejected={rejectedProcIds.has(item.id)}
                  onEdit={() => {
                    setEditingProcId(item.id);
                    setEditingProcValue(item.name);
                    setEditingMedId(null);
                  }}
                  onConfirm={() => setResolutionState(item.id, setConfirmedProcIds, setRejectedProcIds, 'confirmed')}
                  onReject={() => setResolutionState(item.id, setConfirmedProcIds, setRejectedProcIds, 'rejected')}
                />
              ) : null}
            </View>
          ))
        ) : (
          <Text style={[reviewStyles.noneFound, { color: colors.icon }]}>
            None found in health records
          </Text>
        )}
        <TouchableOpacity
          style={reviewStyles.addMedButton}
          onPress={() => {
            const prefix = isBPHSection ? 'bph_custom' : 'other_proc_custom';
            const newId = `${prefix}_${Date.now()}`;
            setEditableProcs(prev => [...prev, {
              id: newId,
              name: '',
              commonName: undefined,
              date: undefined,
              isBPH: isBPHSection,
            }]);
            setEditingProcId(newId);
            setEditingProcValue('');
            setEditingMedId(null);
            setEditingCondId(null);
          }}
          activeOpacity={0.7}
        >
          <Text style={[reviewStyles.addMedButtonText, { color: StanfordColors.cardinal }]}>
            {isBPHSection ? '+ Add BPH Surgery' : '+ Add Surgery'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderStepContent() {
    if (!prefillData) return null;

    switch (reviewStep) {
      case 0:
        return (
          <>
            <View style={[reviewStyles.card, { backgroundColor: sectionBg }]}>
              {/* Age — static if from Apple Health, editable input otherwise */}
              {prefillData.demographics.age.confidence !== 'none' && prefillData.demographics.age.value != null ? (
                <DataRow
                  label="Age"
                  value={`${prefillData.demographics.age.value} years`}
                  found
                  actions={(
                    <RowActionIcons
                      checked={confirmedDemoFields.has('age')}
                      onEdit={() => {}}
                      showEdit={false}
                      onConfirm={() => updateConfirmedSet(setConfirmedDemoFields, 'age')}
                    />
                  )}
                  colors={colors}
                  borderColor={borderColor}
                />
              ) : (
                <InlineInputRow
                  label="Age"
                  value={demoAge}
                  onChange={setDemoAge}
                  onSubmit={() => {}}
                  keyboardType="number-pad"
                  autoFocus={false}
                  placeholder="Enter age in years"
                  autoCapitalize="none"
                  colors={colors}
                  borderColor={borderColor}
                />
              )}

              {/* Biological Sex — static if from Apple Health, picker otherwise */}
              {prefillData.demographics.biologicalSex.confidence !== 'none' && prefillData.demographics.biologicalSex.value ? (
                <DataRow
                  label="Biological Sex"
                  value={capitalize(prefillData.demographics.biologicalSex.value)}
                  found
                  actions={(
                    <RowActionIcons
                      checked={confirmedDemoFields.has('biologicalSex')}
                      showEdit={false}
                      onConfirm={() => updateConfirmedSet(setConfirmedDemoFields, 'biologicalSex')}
                    />
                  )}
                  colors={colors}
                  borderColor={borderColor}
                />
              ) : demoBiologicalSex ? (
                <DataRow
                  label="Biological Sex"
                  value={demoBiologicalSex}
                  found
                  showBadge={false}
                  actions={(
                    <RowActionIcons
                      onEdit={() => openPicker('biologicalSex')}
                    />
                  )}
                  colors={colors}
                  borderColor={borderColor}
                />
              ) : (
                <SelectDataRow
                  label="Biological Sex"
                  onPress={() => openPicker('biologicalSex')}
                  colors={colors}
                  borderColor={borderColor}
                />
              )}

              <InlineInputRow
                label="Phone Number"
                value={demoPhone}
                onChange={setDemoPhone}
                onSubmit={() => {}}
                keyboardType="phone-pad"
                autoFocus={false}
                placeholder="Enter phone number"
                autoCapitalize="none"
                colors={colors}
                borderColor={borderColor}
              />

              {/* Ethnicity — tap-to-select, then locks as static (double-tap to re-open) */}
              {(demoStage === 'ethnicity' || demoStage === 'race' || demoStage === 'done') && (
                demoEthnicity ? (
                  <DataRow
                    label="Ethnicity"
                    value={demoEthnicity}
                    found
                    showBadge={false}
                    actions={(
                      <RowActionIcons
                        onEdit={() => openPicker('ethnicity')}
                        checked={false}
                      />
                    )}
                    colors={colors}
                    borderColor={borderColor}
                  />
                ) : (
                  <SelectDataRow
                    label="Ethnicity"
                    onPress={() => openPicker('ethnicity')}
                    colors={colors}
                    borderColor={borderColor}
                  />
                )
              )}

              {/* Race — tap-to-select, then locks as static (double-tap to re-open) */}
              {(demoStage === 'race' || demoStage === 'done') && (
                demoRace ? (
                  <DataRow
                    label="Race"
                    value={demoRace}
                    found
                    showBadge={false}
                    actions={(
                      <RowActionIcons
                        onEdit={() => openPicker('race')}
                        checked={false}
                      />
                    )}
                    colors={colors}
                    borderColor={borderColor}
                  />
                ) : (
                  <SelectDataRow
                    label="Race"
                    onPress={() => openPicker('race')}
                    colors={colors}
                    borderColor={borderColor}
                  />
                )
              )}
            </View>
          </>
        );

      case 1: {
        return (
          <>
            {/* All health-record medications in a single flat list */}
            <View style={[reviewStyles.card, { backgroundColor: sectionBg }]}>
              <Text style={[reviewStyles.cardSectionTitle, { color: colors.icon }]}>
                MEDICATIONS FROM HEALTH RECORDS
              </Text>
              <View style={reviewStyles.medGroup}>
                {editableMeds.length > 0 ? (
                  editableMeds.map(item => (
                    <View key={item.id} style={reviewStyles.medItem}>
                      <Text style={[reviewStyles.medBullet, { color: StanfordColors.cardinal }]}>•</Text>
                      {editingMedId === item.id ? (
                        <TextInput
                          value={editingMedValue}
                          onChangeText={setEditingMedValue}
                          onSubmitEditing={() => {
                            setEditableMeds(prev => prev.map(m =>
                              m.id === item.id ? { ...m, name: editingMedValue.trim() || m.name } : m
                            ));
                            setEditingMedId(null);
                          }}
                          returnKeyType="done"
                          autoFocus
                          style={[reviewStyles.medEditInput, { color: colors.text }]}
                        />
                      ) : (
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => handleFieldDoubleTap(`med_${item.id}`, () => {
                            setEditingMedId(item.id);
                            setEditingMedValue(item.name);
                            setEditingProcId(null);
                          })}
                          activeOpacity={0.8}
                        >
                          {item.brandName ? (
                            <Text style={[reviewStyles.medName, { color: colors.text }]}>
                              {item.brandName}{' '}
                              <Text style={reviewStyles.medNameSecondary}>({item.name})</Text>
                            </Text>
                          ) : (
                            <Text style={[reviewStyles.medName, { color: colors.text }]}>{item.name}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                      {editingMedId !== item.id ? (
                        <RowActionIcons
                          checked={confirmedMedIds.has(item.id)}
                          rejected={rejectedMedIds.has(item.id)}
                          onEdit={() => {
                            setEditingMedId(item.id);
                            setEditingMedValue(item.name);
                            setEditingProcId(null);
                          }}
                          onConfirm={() => setResolutionState(item.id, setConfirmedMedIds, setRejectedMedIds, 'confirmed')}
                          onReject={() => setResolutionState(item.id, setConfirmedMedIds, setRejectedMedIds, 'rejected')}
                        />
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={[reviewStyles.noneFound, { color: colors.icon }]}>
                    None found in health records
                  </Text>
                )}
              </View>
            </View>

            {/* Other medications not captured from health records */}
            <View style={[reviewStyles.card, { backgroundColor: sectionBg, marginTop: 12 }]}>
              <Text style={[reviewStyles.cardSectionTitle, { color: colors.icon }]}>
                OTHER MEDICATIONS
              </Text>
              <View style={reviewStyles.medGroup}>
                {otherMeds.length === 0 && (
                  <Text style={[reviewStyles.noneFound, { color: colors.icon }]}>
                    None
                  </Text>
                )}
                {otherMeds.map(item => (
                  <View key={item.id} style={reviewStyles.medItem}>
                    <Text style={[reviewStyles.medBullet, { color: StanfordColors.cardinal }]}>•</Text>
                    {editingMedId === item.id ? (
                      <TextInput
                        value={editingMedValue}
                        onChangeText={setEditingMedValue}
                        onSubmitEditing={() => {
                          const trimmed = editingMedValue.trim();
                          if (trimmed) {
                            setOtherMeds(prev => prev.map(m =>
                              m.id === item.id ? { ...m, name: trimmed } : m
                            ));
                          } else {
                            setOtherMeds(prev => prev.filter(m => m.id !== item.id));
                          }
                          setEditingMedId(null);
                        }}
                        returnKeyType="done"
                        autoFocus
                        placeholder="Medication name"
                        placeholderTextColor={colors.icon}
                        style={[reviewStyles.medEditInput, { color: colors.text }]}
                      />
                    ) : (
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => handleFieldDoubleTap(`othermed_${item.id}`, () => {
                          setEditingMedId(item.id);
                          setEditingMedValue(item.name);
                          setEditingProcId(null);
                        })}
                        activeOpacity={0.8}
                      >
                        <Text style={[reviewStyles.medName, { color: colors.text }]}>{item.name}</Text>
                      </TouchableOpacity>
                    )}
                    {editingMedId !== item.id ? (
                      <RowActionIcons
                        checked={confirmedMedIds.has(item.id)}
                        rejected={rejectedMedIds.has(item.id)}
                        onEdit={() => {
                          setEditingMedId(item.id);
                          setEditingMedValue(item.name);
                          setEditingProcId(null);
                        }}
                        onConfirm={() => setResolutionState(item.id, setConfirmedMedIds, setRejectedMedIds, 'confirmed')}
                        onReject={() => setResolutionState(item.id, setConfirmedMedIds, setRejectedMedIds, 'rejected')}
                      />
                    ) : null}
                  </View>
                ))}
                <TouchableOpacity
                  style={reviewStyles.addMedButton}
                  onPress={() => {
                    const newId = `other_custom_${Date.now()}`;
                    setOtherMeds(prev => [...prev, { id: newId, name: '', groupKey: 'other' }]);
                    setEditingMedId(newId);
                    setEditingMedValue('');
                    setEditingProcId(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[reviewStyles.addMedButtonText, { color: StanfordColors.cardinal }]}>
                    + Add Medication
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        );
      }

      case 2: {
        return (
          <View style={[reviewStyles.card, { backgroundColor: sectionBg }]}>
            <ProcedureSection
              label="BPH / PROSTATE PROCEDURES"
              items={editableProcs.filter(p => p.isBPH)}
            />
            <View style={[reviewStyles.divider, { backgroundColor: borderColor }]} />
            <ProcedureSection
              label="OTHER SURGERIES"
              items={editableProcs.filter(p => !p.isBPH)}
            />
          </View>
        );
      }

      case 3: {
        return (
          <>
            {/* Health-record conditions */}
            <View style={[reviewStyles.card, { backgroundColor: sectionBg }]}>
              <Text style={[reviewStyles.cardSectionTitle, { color: colors.icon }]}>
                CONDITIONS FROM HEALTH RECORDS
              </Text>
              <View style={reviewStyles.medGroup}>
                {editableHealthConds.length > 0 ? (
                  editableHealthConds.map(cond => (
                    <View key={cond.id} style={reviewStyles.medItem}>
                      <Text style={[reviewStyles.medBullet, { color: StanfordColors.cardinal }]}>•</Text>
                      {editingCondId === cond.id ? (
                        <TextInput
                          value={editingCondValue}
                          onChangeText={setEditingCondValue}
                          onSubmitEditing={() => {
                            const trimmed = editingCondValue.trim();
                            setEditableHealthConds(prev => prev.map(item =>
                              item.id === cond.id ? { ...item, name: trimmed || item.name } : item
                            ));
                            setEditingCondId(null);
                          }}
                          returnKeyType="done"
                          autoFocus
                          placeholder="Condition name"
                          placeholderTextColor={colors.icon}
                          style={[reviewStyles.medEditInput, { color: colors.text }]}
                        />
                      ) : (
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => handleFieldDoubleTap(`cond_${cond.id}`, () => {
                            setEditingCondId(cond.id);
                            setEditingCondValue(cond.name);
                            setEditingMedId(null);
                            setEditingProcId(null);
                          })}
                          activeOpacity={0.8}
                        >
                          <Text style={[reviewStyles.medName, { color: colors.text, flex: 1 }]}>
                            {cond.name}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {editingCondId !== cond.id ? (
                        <RowActionIcons
                          checked={confirmedCondIds.has(cond.id)}
                          rejected={rejectedCondIds.has(cond.id)}
                          onEdit={() => {
                            setEditingCondId(cond.id);
                            setEditingCondValue(cond.name);
                            setEditingMedId(null);
                            setEditingProcId(null);
                          }}
                          onConfirm={() => setResolutionState(cond.id, setConfirmedCondIds, setRejectedCondIds, 'confirmed')}
                          onReject={() => setResolutionState(cond.id, setConfirmedCondIds, setRejectedCondIds, 'rejected')}
                        />
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={[reviewStyles.noneFound, { color: colors.icon }]}>
                    No conditions found in health records
                  </Text>
                )}
              </View>
            </View>

            {/* User-added conditions */}
            <View style={[reviewStyles.card, { backgroundColor: sectionBg, marginTop: 12 }]}>
              <Text style={[reviewStyles.cardSectionTitle, { color: colors.icon }]}>
                OTHER CONDITIONS
              </Text>
              <View style={reviewStyles.medGroup}>
                {otherConds.length === 0 && (
                  <Text style={[reviewStyles.noneFound, { color: colors.icon }]}>None</Text>
                )}
                {otherConds.map(item => (
                  <View key={item.id} style={reviewStyles.medItem}>
                    <Text style={[reviewStyles.medBullet, { color: StanfordColors.cardinal }]}>•</Text>
                    {editingCondId === item.id ? (
                      <TextInput
                        value={editingCondValue}
                        onChangeText={setEditingCondValue}
                        onSubmitEditing={() => {
                          const trimmed = editingCondValue.trim();
                          if (trimmed) {
                            setOtherConds(prev => prev.map(c =>
                              c.id === item.id ? { ...c, name: trimmed } : c
                            ));
                          } else {
                            setOtherConds(prev => prev.filter(c => c.id !== item.id));
                          }
                          setEditingCondId(null);
                        }}
                        returnKeyType="done"
                        autoFocus
                        placeholder="Condition name"
                        placeholderTextColor={colors.icon}
                        style={[reviewStyles.medEditInput, { color: colors.text }]}
                      />
                    ) : (
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => handleFieldDoubleTap(`cond_${item.id}`, () => {
                          setEditingCondId(item.id);
                          setEditingCondValue(item.name);
                          setEditingMedId(null);
                          setEditingProcId(null);
                        })}
                        activeOpacity={0.8}
                      >
                        <Text style={[reviewStyles.medName, { color: colors.text }]}>{item.name}</Text>
                      </TouchableOpacity>
                    )}
                    {editingCondId !== item.id ? (
                      <RowActionIcons
                        checked={confirmedCondIds.has(item.id)}
                        rejected={rejectedCondIds.has(item.id)}
                        onEdit={() => {
                          setEditingCondId(item.id);
                          setEditingCondValue(item.name);
                          setEditingMedId(null);
                          setEditingProcId(null);
                        }}
                        onConfirm={() => setResolutionState(item.id, setConfirmedCondIds, setRejectedCondIds, 'confirmed')}
                        onReject={() => setResolutionState(item.id, setConfirmedCondIds, setRejectedCondIds, 'rejected')}
                      />
                    ) : null}
                  </View>
                ))}
                <TouchableOpacity
                  style={reviewStyles.addMedButton}
                  onPress={() => {
                    const newId = `cond_custom_${Date.now()}`;
                    setOtherConds(prev => [...prev, { id: newId, name: '' }]);
                    setEditingCondId(newId);
                    setEditingCondValue('');
                    setEditingMedId(null);
                    setEditingProcId(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[reviewStyles.addMedButtonText, { color: StanfordColors.cardinal }]}>
                    + Add Condition
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        );
      }

      default:
        return null;
    }
  }

  // ── Loading phase ─────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <OnboardingProgressBar currentStep={OnboardingStep.MEDICAL_HISTORY} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={StanfordColors.cardinal} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Checking your health records...
          </Text>
          <Text style={[styles.loadingSubtext, { color: colors.icon }]}>
            Looking for medications, conditions, and procedures
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Reviewing phase ───────────────────────────────────────────────

  if (phase === 'reviewing' || phase === 'complete') {
    const isLastStep = reviewStep === STEP_TITLES.length - 1;

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <OnboardingProgressBar currentStep={OnboardingStep.MEDICAL_HISTORY} />
        </View>

        {/* Step indicator and title — hidden on completion screen */}
        {phase !== 'complete' && (
          <>
            <View style={reviewStyles.stepHeader}>
              <View style={reviewStyles.stepDots}>
                {STEP_TITLES.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      reviewStyles.stepDot,
                      i < reviewStep
                        ? { backgroundColor: StanfordColors.cardinal, opacity: 0.5 }
                        : i === reviewStep
                        ? { backgroundColor: StanfordColors.cardinal }
                        : { backgroundColor: colors.border },
                    ]}
                  />
                ))}
              </View>
              <Text style={[reviewStyles.stepCounter, { color: colors.icon }]}>
                Step {reviewStep + 1} of {STEP_TITLES.length}
              </Text>
            </View>

            <View style={reviewStyles.titleRow}>
              <View style={reviewStyles.titleRowHeader}>
                <Text style={[reviewStyles.stepTitle, { color: colors.text }]}>
                  {STEP_TITLES[reviewStep]}
                </Text>
                <TouchableOpacity
                  onPress={loadPrefillData}
                  style={reviewStyles.refreshButton}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh from Apple Health"
                >
                  <IconSymbol
                    name={"arrow.clockwise" as any}
                    size={16}
                    color={StanfordColors.cardinal}
                  />
                  <Text style={reviewStyles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
              <Text style={[reviewStyles.stepDesc, { color: colors.icon }]}>
                {STEP_DESCRIPTIONS[reviewStep]}
              </Text>
            </View>
          </>
        )}

        {/* Step content or completion screen */}
        {phase === 'complete' ? (
          <Animated.View style={[styles.completeContainer, { opacity: confirmFade }]}>
            <IconSymbol name="checkmark.circle.fill" size={64} color="#34C759" />
            <Text style={[styles.completeTitle, { color: colors.text }]}>
              All Confirmed
            </Text>
            <Text style={[styles.completeSubtitle, { color: colors.icon }]}>
              Your health records have been reviewed. You&apos;re ready to continue.
            </Text>
            <ContinueButton
              title="Continue to Baseline Survey"
              onPress={handleContinue}
              style={{ marginTop: Spacing.lg }}
            />
          </Animated.View>
        ) : (
          <>
            <Animated.View style={[{ flex: 1 }, { opacity: stepFade }]}>
              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={reviewStyles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {renderStepContent()}
              </ScrollView>
            </Animated.View>

            <View style={[reviewStyles.actionContainer, { backgroundColor: colors.background, borderTopColor: borderColor }]}>
              <View style={reviewStyles.footerButtons}>
                <TouchableOpacity
                  style={[reviewStyles.backButton, { borderColor }]}
                  onPress={handlePreviousStep}
                  activeOpacity={0.7}
                >
                  <Text style={[reviewStyles.backButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
                <ContinueButton
                  title={isLastStep ? 'Next' : 'Next'}
                  onPress={handleNextStep}
                  disabled={!stepCanProceed}
                  style={reviewStyles.nextButton}
                />
              </View>
            </View>
          </>
        )}

        {/* Bottom sheet picker for Ethnicity / Race / Biological Sex */}
        <Modal
          visible={pickerVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerVisible(false)}
        >
          <Pressable style={reviewStyles.pickerBackdrop} onPress={() => setPickerVisible(false)}>
            <Pressable style={[reviewStyles.pickerSheet, { backgroundColor: sectionBg }]}>
              <View style={[reviewStyles.pickerHandle, { backgroundColor: borderColor }]} />
              <Text style={[reviewStyles.pickerTitle, { color: colors.icon }]}>
                {pickerField === 'ethnicity' ? 'ETHNICITY' : pickerField === 'race' ? 'RACE' : 'BIOLOGICAL SEX'}
              </Text>
              {(pickerField === 'ethnicity' ? ETHNICITY_OPTIONS : pickerField === 'race' ? RACE_OPTIONS : SEX_OPTIONS).map(option => {
                const selected = pickerField === 'ethnicity'
                  ? demoEthnicity === option
                  : pickerField === 'race'
                  ? demoRace === option
                  : demoBiologicalSex === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[reviewStyles.pickerOption, { borderBottomColor: borderColor }]}
                    onPress={() => handlePickerSelect(option)}
                    activeOpacity={0.7}
                  >
                    <Text style={[reviewStyles.pickerOptionText, { color: colors.text }]}>
                      {option}
                    </Text>
                    {selected && (
                      <IconSymbol name="checkmark" size={16} color={StanfordColors.cardinal} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>

      </SafeAreaView>
    );
  }
}

// ── Review-specific styles ────────────────────────────────────────────

const reviewStyles = StyleSheet.create({
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  stepDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: '500',
  },
  titleRow: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: 4,
  },
  titleRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  stepDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(140, 21, 21, 0.08)',
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: StanfordColors.cardinal,
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    gap: 0,
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
  },
  dataLabel: {
    fontSize: 15,
    fontWeight: '400',
    flex: 1,
  },
  dataRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  dataValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  willAskText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  sourceBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2E7D32',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.md,
  },
  medGroup: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 6,
  },
  medGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  medItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  medBullet: {
    fontSize: 16,
    lineHeight: 20,
  },
  medName: {
    fontSize: 15,
    flex: 1,
    fontWeight: '500',
  },
  medNameSecondary: {
    fontSize: 13,
    fontWeight: '400',
    opacity: 0.6,
  },
  procNameRow: {
    flex: 1,
    gap: 2,
  },
  procDate: {
    fontSize: 12,
  },
  noneFound: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 2,
  },
  addMedButton: {
    marginTop: 10,
    paddingVertical: 8,
  },
  addMedButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  epicCardBody: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  epicCardText: {
    fontSize: 14,
    lineHeight: 20,
  },
  epicButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  epicButtonPrimary: {
    backgroundColor: StanfordColors.cardinal,
  },
  epicButtonConnected: {
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
  },
  epicButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  epicButtonTextPrimary: {
    color: '#FFFFFF',
  },
  epicButtonTextConnected: {
    color: '#1F7A37',
  },
  actionContainer: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  backButton: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  nextButton: {
    flex: 1,
  },
  inlineInput: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 22,
  },
  selectHint: {
    fontSize: 15,
    fontWeight: '500',
  },
  medEditInput: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(140, 21, 21, 0.08)',
  },
  actionButtonConfirmed: {
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
  },
  actionButtonRejected: {
    backgroundColor: 'rgba(217, 48, 37, 0.12)',
  },
  labValueInput: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    minWidth: 96,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: Spacing.screenHorizontal,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenHorizontal,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerOptionText: {
    fontSize: 17,
  },
  labRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  labLeft: {
    flex: 1,
    gap: 2,
  },
  labName: {
    fontSize: 15,
    fontWeight: '600',
  },
  labDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  labRight: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 1,
  },
  labValue: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
  },
  labMeta: {
    fontSize: 11,
    textAlign: 'right',
  },
});

// ── Shared styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  completeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenHorizontal,
    gap: Spacing.md,
  },
  completeTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  completeSubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.screenHorizontal,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
  },
  loadingSubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
});
