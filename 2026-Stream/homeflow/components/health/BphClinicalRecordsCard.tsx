/**
 * BPH Clinical Records Card — Health tab
 *
 * Lets a participant view + edit the BPH-relevant slice of their
 * medical_history/current document. Three sections:
 *   1. Medications (filtered to BPH-relevant groupKeys)
 *   2. Surgical procedures (filtered to isBPH === true)
 *   3. Conditions (filtered with isBphCondition() text patterns)
 *
 * Edit model:
 *   - Tap "Edit" on a row → expand inline editor for that row.
 *   - Tap trash → row deleted from local state (not yet saved).
 *   - "+ Add" button at the bottom of each section.
 *   - Save button at the bottom of the card commits ALL pending changes
 *     to Firestore in one batch (one write per section that changed).
 *
 * Why a single Save instead of per-row save:
 *   - Cleaner mental model — user batches their edits like a form.
 *   - Lets us show "Unsaved changes" affordance and a Cancel option.
 *   - Cuts Firestore writes when the user is fixing 3 entries at once.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { getAuth } from '@/src/services/firestore';
import type {
  MedHistoryCondition,
  MedHistoryMedication,
  MedHistoryProcedure,
} from '@/src/services/throneFirestore';
import {
  BPH_MED_GROUP_OPTIONS,
  isBphCondition,
  isBphMedication,
  medGroupLabel,
  saveConditions,
  saveMedications,
  saveProcedures,
  subscribeToMedicalHistory,
} from '@/lib/services/medical-history-edit';

interface SectionState<T> {
  items: T[];
  dirty: boolean;
}

const NEW_MEDICATION = (): MedHistoryMedication => ({
  name: '',
  brandName: '',
  groupKey: 'alphaBlockers',
});

const NEW_PROCEDURE = (): MedHistoryProcedure => ({
  name: '',
  date: '',
  isBPH: true, // we're in the BPH section — always true for new entries here
});

const NEW_CONDITION = (): MedHistoryCondition => ({ name: '' });

export function BphClinicalRecordsCard() {
  const { theme } = useAppTheme();
  const { colors: c } = theme;

  const [meds, setMeds] = useState<SectionState<MedHistoryMedication>>({
    items: [],
    dirty: false,
  });
  const [procs, setProcs] = useState<SectionState<MedHistoryProcedure>>({
    items: [],
    dirty: false,
  });
  const [conds, setConds] = useState<SectionState<MedHistoryCondition>>({
    items: [],
    dirty: false,
  });
  // We hold the FULL non-BPH portions of each list so saving doesn't drop
  // them. The Firestore array is the union of (BPH items, here) +
  // (non-BPH items, frozen here) at save time.
  const [otherMeds, setOtherMeds] = useState<MedHistoryMedication[]>([]);
  const [otherProcs, setOtherProcs] = useState<MedHistoryProcedure[]>([]);
  const [otherConds, setOtherConds] = useState<MedHistoryCondition[]>([]);

  const [loading, setLoading] = useState(true);
  const [docExists, setDocExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }
    const unsub = subscribeToMedicalHistory(uid, (snap) => {
      setLoading(false);
      setDocExists(snap.exists);
      if (!snap.data) return;
      const allMeds = snap.data.medications ?? [];
      const allProcs = snap.data.surgicalHistory ?? [];
      const allConds = snap.data.conditions ?? [];

      const bphMeds = allMeds.filter(isBphMedication);
      const otherMedsList = allMeds.filter((m) => !isBphMedication(m));
      const bphProcs = allProcs.filter((p) => p.isBPH);
      const otherProcsList = allProcs.filter((p) => !p.isBPH);
      const bphConds = allConds.filter((c) => isBphCondition(c.name));
      const otherCondsList = allConds.filter((c) => !isBphCondition(c.name));

      // Only overwrite local state if there are no unsaved changes —
      // otherwise a Firestore snapshot from elsewhere (or our own write)
      // would clobber what the user is currently editing.
      setMeds((prev) => (prev.dirty ? prev : { items: bphMeds, dirty: false }));
      setProcs((prev) => (prev.dirty ? prev : { items: bphProcs, dirty: false }));
      setConds((prev) => (prev.dirty ? prev : { items: bphConds, dirty: false }));
      setOtherMeds(otherMedsList);
      setOtherProcs(otherProcsList);
      setOtherConds(otherCondsList);
    });
    return unsub;
  }, []);

  const dirty = meds.dirty || procs.dirty || conds.dirty;

  async function handleSaveAll() {
    const uid = getAuth().currentUser?.uid;
    if (!uid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // For each section that changed, write the union of (edited BPH
      // items) + (frozen non-BPH items). Keeps the doc structure intact.
      const ops: Promise<void>[] = [];
      if (meds.dirty) {
        const cleaned = meds.items.filter((m) => m.name.trim().length > 0);
        ops.push(saveMedications(uid, [...cleaned, ...otherMeds]));
      }
      if (procs.dirty) {
        const cleaned = procs.items.filter((p) => p.name.trim().length > 0);
        ops.push(saveProcedures(uid, [...cleaned, ...otherProcs]));
      }
      if (conds.dirty) {
        const cleaned = conds.items.filter((c) => c.name.trim().length > 0);
        ops.push(saveConditions(uid, [...cleaned, ...otherConds]));
      }
      await Promise.all(ops);
      // Mark sections clean — the snapshot listener will overwrite local
      // state with the server-stamped version on its next fire.
      setMeds((s) => ({ ...s, dirty: false }));
      setProcs((s) => ({ ...s, dirty: false }));
      setConds((s) => ({ ...s, dirty: false }));
      setEditingId(null);
    } catch (err) {
      console.warn('[bphRecords] save failed', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.headerRow}>
          <IconSymbol name="bandage.fill" size={17} color={c.accent} />
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>BPH Clinical Records</Text>
        </View>
        <ActivityIndicator size="small" color={c.textTertiary} style={{ marginVertical: 14 }} />
      </View>
    );
  }

  if (!docExists) {
    return (
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.headerRow}>
          <IconSymbol name="bandage.fill" size={17} color={c.accent} />
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>BPH Clinical Records</Text>
        </View>
        <Text style={[styles.empty, { color: c.textTertiary }]}>
          Your BPH-related medications, procedures, and conditions will appear here once you complete the medical history step in onboarding.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.card }]}>
      <View style={styles.headerRow}>
        <IconSymbol name="bandage.fill" size={17} color={c.accent} />
        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>BPH Clinical Records</Text>
        {dirty && (
          <Text style={[styles.unsavedTag, { color: c.semanticWarning }]}>Unsaved changes</Text>
        )}
      </View>
      <Text style={[styles.helpText, { color: c.textTertiary }]}>
        Pre-loaded from your Apple Health clinical records and the medical history step in onboarding. Review and update — changes save to your study record.
      </Text>

      {/* ── Medications ───────────────────────────────────────── */}
      <SectionHeader title="BPH Medications" iconName="pills.fill" c={c} />
      <View style={styles.sectionBody}>
        {meds.items.length === 0 && (
          <Text style={[styles.emptyRow, { color: c.textTertiary }]}>
            No BPH medications found in your records. Tap &quot;Add medication&quot; to add one.
          </Text>
        )}
        {meds.items.map((m, idx) => {
          const id = `med-${idx}`;
          const isEditing = editingId === id;
          return (
            <RowContainer key={id} c={c} isLast={idx === meds.items.length - 1}>
              {isEditing ? (
                <View style={styles.editBlock}>
                  <LabeledField label="Medication name" c={c}>
                    <TextInput
                      value={m.name}
                      onChangeText={(v) => updateAt(setMeds, idx, { ...m, name: v })}
                      style={[styles.input, { color: c.textPrimary, borderColor: c.separator }]}
                      placeholder="e.g. tamsulosin"
                      placeholderTextColor={c.textTertiary}
                    />
                  </LabeledField>
                  <LabeledField label="Brand name (optional)" c={c}>
                    <TextInput
                      value={m.brandName ?? ''}
                      onChangeText={(v) => updateAt(setMeds, idx, { ...m, brandName: v })}
                      style={[styles.input, { color: c.textPrimary, borderColor: c.separator }]}
                      placeholder="e.g. Flomax"
                      placeholderTextColor={c.textTertiary}
                    />
                  </LabeledField>
                  <LabeledField label="Drug class" c={c}>
                    <View style={styles.optionRow}>
                      {BPH_MED_GROUP_OPTIONS.map((opt) => {
                        const selected = m.groupKey === opt.value;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            onPress={() => updateAt(setMeds, idx, { ...m, groupKey: opt.value })}
                            style={[
                              styles.option,
                              {
                                backgroundColor: selected ? c.accent : c.background,
                                borderColor: selected ? c.accent : c.separator,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.optionText,
                                { color: selected ? '#fff' : c.textSecondary },
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </LabeledField>
                  <View style={styles.editActions}>
                    <TouchableOpacity onPress={() => setEditingId(null)}>
                      <Text style={[styles.actionLink, { color: c.accent }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: c.textPrimary }]}>
                      {m.name || '(unnamed medication)'}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.textTertiary }]}>
                      {m.brandName ? `${m.brandName} · ` : ''}{medGroupLabel(m.groupKey)}
                    </Text>
                  </View>
                  <RowActions
                    c={c}
                    onEdit={() => setEditingId(id)}
                    onDelete={() => removeAt(setMeds, idx)}
                  />
                </View>
              )}
            </RowContainer>
          );
        })}
        <AddButton
          c={c}
          label="Add medication"
          onPress={() => {
            const next = NEW_MEDICATION();
            setMeds((s) => ({ items: [...s.items, next], dirty: true }));
            setEditingId(`med-${meds.items.length}`);
          }}
        />
      </View>

      {/* ── Procedures ────────────────────────────────────────── */}
      <SectionHeader title="BPH Procedures" iconName="wrench.fill" c={c} />
      <View style={styles.sectionBody}>
        {procs.items.length === 0 && (
          <Text style={[styles.emptyRow, { color: c.textTertiary }]}>
            No BPH procedures found in your records. Tap &quot;Add procedure&quot; to add one.
          </Text>
        )}
        {procs.items.map((p, idx) => {
          const id = `proc-${idx}`;
          const isEditing = editingId === id;
          return (
            <RowContainer key={id} c={c} isLast={idx === procs.items.length - 1}>
              {isEditing ? (
                <View style={styles.editBlock}>
                  <LabeledField label="Procedure name" c={c}>
                    <TextInput
                      value={p.name}
                      onChangeText={(v) => updateAt(setProcs, idx, { ...p, name: v })}
                      style={[styles.input, { color: c.textPrimary, borderColor: c.separator }]}
                      placeholder="e.g. HoLEP"
                      placeholderTextColor={c.textTertiary}
                    />
                  </LabeledField>
                  <LabeledField label="Year (optional)" c={c}>
                    <TextInput
                      value={p.date ?? ''}
                      onChangeText={(v) => updateAt(setProcs, idx, { ...p, date: v.replace(/[^0-9]/g, '').slice(0, 4) })}
                      style={[styles.input, { color: c.textPrimary, borderColor: c.separator }]}
                      placeholder="YYYY"
                      placeholderTextColor={c.textTertiary}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                  </LabeledField>
                  <View style={styles.editActions}>
                    <TouchableOpacity onPress={() => setEditingId(null)}>
                      <Text style={[styles.actionLink, { color: c.accent }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: c.textPrimary }]}>
                      {p.name || '(unnamed procedure)'}
                    </Text>
                    {p.date ? (
                      <Text style={[styles.rowSub, { color: c.textTertiary }]}>{p.date}</Text>
                    ) : null}
                  </View>
                  <RowActions
                    c={c}
                    onEdit={() => setEditingId(id)}
                    onDelete={() => removeAt(setProcs, idx)}
                  />
                </View>
              )}
            </RowContainer>
          );
        })}
        <AddButton
          c={c}
          label="Add procedure"
          onPress={() => {
            const next = NEW_PROCEDURE();
            setProcs((s) => ({ items: [...s.items, next], dirty: true }));
            setEditingId(`proc-${procs.items.length}`);
          }}
        />
      </View>

      {/* ── Conditions ────────────────────────────────────────── */}
      <SectionHeader title="BPH-Related Conditions" iconName="checklist" c={c} />
      <View style={styles.sectionBody}>
        {conds.items.length === 0 && (
          <Text style={[styles.emptyRow, { color: c.textTertiary }]}>
            No BPH-related conditions found in your records. Tap &quot;Add condition&quot; to add one.
          </Text>
        )}
        {conds.items.map((cnd, idx) => {
          const id = `cond-${idx}`;
          const isEditing = editingId === id;
          return (
            <RowContainer key={id} c={c} isLast={idx === conds.items.length - 1}>
              {isEditing ? (
                <View style={styles.editBlock}>
                  <LabeledField label="Condition" c={c}>
                    <TextInput
                      value={cnd.name}
                      onChangeText={(v) => updateAt(setConds, idx, { name: v })}
                      style={[styles.input, { color: c.textPrimary, borderColor: c.separator }]}
                      placeholder="e.g. Benign prostatic hyperplasia"
                      placeholderTextColor={c.textTertiary}
                    />
                  </LabeledField>
                  <View style={styles.editActions}>
                    <TouchableOpacity onPress={() => setEditingId(null)}>
                      <Text style={[styles.actionLink, { color: c.accent }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: c.textPrimary }]}>
                      {cnd.name || '(unnamed condition)'}
                    </Text>
                  </View>
                  <RowActions
                    c={c}
                    onEdit={() => setEditingId(id)}
                    onDelete={() => removeAt(setConds, idx)}
                  />
                </View>
              )}
            </RowContainer>
          );
        })}
        <AddButton
          c={c}
          label="Add condition"
          onPress={() => {
            const next = NEW_CONDITION();
            setConds((s) => ({ items: [...s.items, next], dirty: true }));
            setEditingId(`cond-${conds.items.length}`);
          }}
        />
      </View>

      {/* ── Save bar ──────────────────────────────────────────── */}
      {dirty && (
        <View style={styles.saveBar}>
          {saveError && (
            <Text style={[styles.errorText, { color: c.semanticError }]}>
              {saveError}
            </Text>
          )}
          <TouchableOpacity
            onPress={handleSaveAll}
            disabled={saving}
            style={[
              styles.saveBtn,
              { backgroundColor: saving ? c.secondaryFill : c.accent },
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save changes</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // Helpers used by handlers above; closed over `setMeds` etc.
  function updateAt<T>(
    setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
    idx: number,
    next: T,
  ) {
    setter((s) => {
      const items = s.items.slice();
      items[idx] = next;
      return { items, dirty: true };
    });
  }
  function removeAt<T>(
    setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
    idx: number,
  ) {
    setter((s) => ({
      items: s.items.filter((_, i) => i !== idx),
      dirty: true,
    }));
    setEditingId(null);
  }
}

// ── Subcomponents ──────────────────────────────────────────────

interface ColorTokens {
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  accent: string;
  background: string;
  card: string;
  semanticError: string;
  semanticWarning: string;
  secondaryFill: string;
}

function SectionHeader({
  title,
  iconName,
  c,
}: {
  title: string;
  iconName: string;
  c: ColorTokens;
}) {
  return (
    <View style={styles.subSectionHeader}>
      <IconSymbol name={iconName as any} size={14} color={c.textTertiary} />
      <Text style={[styles.subSectionTitle, { color: c.textSecondary }]}>{title}</Text>
    </View>
  );
}

function RowContainer({
  children,
  isLast,
  c,
}: {
  children: React.ReactNode;
  isLast: boolean;
  c: ColorTokens;
}) {
  return (
    <View
      style={[
        styles.rowContainer,
        !isLast && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.separator,
        },
      ]}
    >
      {children}
    </View>
  );
}

function RowActions({
  c,
  onEdit,
  onDelete,
}: {
  c: ColorTokens;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.rowActions}>
      <TouchableOpacity onPress={onEdit} hitSlop={8} style={styles.iconBtn}>
        <IconSymbol name="pencil" size={16} color={c.accent} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} hitSlop={8} style={styles.iconBtn}>
        <IconSymbol name="xmark" size={16} color={c.semanticError} />
      </TouchableOpacity>
    </View>
  );
}

function AddButton({
  c,
  label,
  onPress,
}: {
  c: ColorTokens;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.addBtn}>
      <Text style={[styles.addBtnPlus, { color: c.accent }]}>+</Text>
      <Text style={[styles.addBtnText, { color: c.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function LabeledField({
  label,
  c,
  children,
}: {
  label: string;
  c: ColorTokens;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textTertiary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', flex: 1 },
  unsavedTag: { fontSize: 11, fontWeight: '600' },
  helpText: { fontSize: 12, lineHeight: 16, marginBottom: 12 },
  subSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  subSectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionBody: {},
  rowContainer: { paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6 },
  emptyRow: { fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  addBtnPlus: { fontSize: 18, fontWeight: '700', lineHeight: 18, marginRight: 2 },
  addBtnText: { fontSize: 14, fontWeight: '600' },
  editBlock: { gap: 10 },
  field: { gap: 4 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontSize: 12, fontWeight: '500' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  actionLink: { fontSize: 14, fontWeight: '600' },
  saveBar: {
    marginTop: 18,
    gap: 8,
  },
  saveBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  errorText: { fontSize: 12, textAlign: 'center' },
  empty: { fontSize: 13, lineHeight: 18, marginTop: 12 },
});
